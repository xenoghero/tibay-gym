import "server-only";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "../firebase-admin";
import { ENTRANCE_DEVICE_ID, type RfidAssignment, type RfidDevice, type RfidCard, type RfidCardChange } from "@/lib/rfid/models";
import { assertDeviceCurrent } from "./auth";
import { ApiError } from "./http";
import { assertPersonAvailable, canonicalUid, documentId, eventId } from "./validation";
import { ENROLLMENT_RECOVERY_MS, fingerprint, makeReceipt, readReceipt } from "./receipts";
import { appendAudit } from "../audit";

export const ASSIGNMENT_TIMEOUT_MS = 120_000;
export const HEARTBEAT_MS = 60_000;
export const OFFLINE_MS = 180_000;
const stamp = (ms: number) => Timestamp.fromMillis(ms);

// Reads first; callers defer cleanup until all their transaction reads finish.
export async function reservation(tx: Transaction, db: Firestore, device: RfidDevice, now: number) {
  const ref = device.activeAssignmentId ? db.doc(`rfidAssignments/${documentId(device.activeAssignmentId)}`) : null;
  const assignment = ref ? (await tx.get(ref)).data() as RfidAssignment | undefined : undefined;
  const active = !!assignment && assignment.status === "pending" && assignment.expiresAt.toMillis() > now;
  if (assignment && assignment.deviceId !== ENTRANCE_DEVICE_ID) throw new ApiError(409, "command-mismatch");
  return { active, assignment, ref, finish: () => {
    if (ref && !active) {
      if (assignment?.status === "pending") tx.update(ref, { status: "expired", lastErrorCode: "assignment-expired" });
      tx.update(db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`), { activeAssignmentId: null, updatedAt: stamp(now) });
    }
  } };
}

export async function startAssignment(adminUid: string, personId: string, operation: unknown, expectedPreviousUid: unknown) {
  documentId(personId);
  if (operation !== "assign" && operation !== "replace") throw new ApiError(400, "invalid-operation");
  const expected = expectedPreviousUid === null ? null : canonicalUid(expectedPreviousUid);
  const db = adminDb();
  const ref = db.collection("rfidAssignments").doc();
  const result = await db.runTransaction(async (tx) => {
    const now = Date.now();
    const deviceRef = db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`);
    const device = (await tx.get(deviceRef)).data() as RfidDevice | undefined;
    if (!device) throw new ApiError(404, "device-not-provisioned");
    const current = await reservation(tx, db, device, now);
    if (current.active) throw new ApiError(409, "enrollment-active");
    const person = (await tx.get(db.doc(`persons/${personId}`))).data();
    assertPersonAvailable(person);
    if ((person!.rfidTagId ?? null) !== expected) throw new ApiError(409, "binding-changed");
    if (operation === "replace" && expected === null) throw new ApiError(409, "no-card-assigned");
    if (!device.enabled || !device.lastSeenAt || now - device.lastSeenAt.toMillis() >= OFFLINE_MS) {
      current.finish();
      return { error: "scanner-offline" } as const;
    }
    current.finish();
    const assignment: RfidAssignment = { personId, deviceId: ENTRANCE_DEVICE_ID, operation,
      expectedPreviousUid: expected, status: "pending", capturedUid: null, createdBy: adminUid,
      createdAt: stamp(now), expiresAt: stamp(now + ASSIGNMENT_TIMEOUT_MS), completedAt: null, lastErrorCode: null };
    tx.set(ref, assignment);
    tx.update(deviceRef, { activeAssignmentId: ref.id, updatedAt: stamp(now) });
    appendAudit(tx, db, { actorId: adminUid, action: "rfid-assignment-started", entityType: "rfidAssignment", entityId: ref.id,
      personId, operationId: ref.id, after: { status: "pending" } });
    return { assignmentId: ref.id, expiresAt: now + ASSIGNMENT_TIMEOUT_MS };
  });
  if (result.error) throw new ApiError(409, result.error);
  return result;
}

export async function cancelAssignment(assignmentId: string, actorId = "system") {
  documentId(assignmentId);
  const db = adminDb();
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const ref = db.doc(`rfidAssignments/${assignmentId}`);
    const assignment = (await tx.get(ref)).data() as RfidAssignment | undefined;
    if (!assignment || assignment.deviceId !== ENTRANCE_DEVICE_ID) throw new ApiError(404, "assignment-not-found");
    const deviceRef = db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`);
    const device = (await tx.get(deviceRef)).data() as RfidDevice | undefined;
    const status = assignment.status === "pending" ? (assignment.expiresAt.toMillis() <= now ? "expired" : "cancelled") : assignment.status;
    if (assignment.status === "pending") tx.update(ref, { status, lastErrorCode: null });
    if (device?.activeAssignmentId === assignmentId) tx.update(deviceRef, { activeAssignmentId: null, updatedAt: stamp(now) });
    if (assignment.status === "pending") appendAudit(tx, db, { actorId, action: "rfid-assignment-cancelled", entityType: "rfidAssignment", entityId: assignmentId,
      personId: assignment.personId, operationId: `cancel-${assignmentId}`, before: { status: assignment.status }, after: { status } });
    return { status };
  });
}

export async function pollCommand(request: Request) {
  const db = adminDb();
  let heartbeatWritten = false;
  const result = await db.runTransaction(async (tx) => {
    heartbeatWritten = false;
    const now = Date.now();
    const deviceRef = db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`);
    const device = (await tx.get(deviceRef)).data() as RfidDevice | undefined;
    assertDeviceCurrent(request, device);
    const current = await reservation(tx, db, device!, now);
    const person = current.active ? (await tx.get(db.doc(`persons/${current.assignment!.personId}`))).data() : undefined;
    current.finish();
    const unavailable = current.active && (!person || person.deletingAt != null);
    if (unavailable) {
      tx.update(current.ref!, { status: "cancelled", lastErrorCode: "person-unavailable" });
      tx.update(deviceRef, { activeAssignmentId: null, updatedAt: stamp(now) });
    }
    if (!device!.lastSeenAt || now - device!.lastSeenAt.toMillis() >= HEARTBEAT_MS) {
      heartbeatWritten = true;
      tx.update(deviceRef, { lastSeenAt: stamp(now), updatedAt: stamp(now) });
      tx.set(db.doc(`rfidDeviceStatus/${ENTRANCE_DEVICE_ID}`), {
        label: device!.label, enabled: device!.enabled, lastSeenAt: stamp(now), updatedAt: stamp(now),
      });
    }
    return current.active && !unavailable ? { mode: "enrollment", assignmentId: current.ref!.id,
      operation: current.assignment!.operation, expiresAt: current.assignment!.expiresAt.toMillis(),
      lastErrorCode: current.assignment!.lastErrorCode, pollAfterMs: 2_000 } : { mode: "attendance", pollAfterMs: 15_000 };
  });
  if (heartbeatWritten) console.info(JSON.stringify({ metric: "rfid-heartbeat", documentWrites: 2 }));
  return result;
}

export async function captureAssignment(request: Request, body: Record<string, unknown>) {
  if (body.mode !== "enrollment") throw new ApiError(400, "invalid-mode");
  if (documentId(body.deviceId) !== ENTRANCE_DEVICE_ID) throw new ApiError(403, "device-mismatch");
  const assignmentId = documentId(body.assignmentId);
  const event = eventId(body.eventId);
  if (typeof body.requestedAt !== "number") throw new ApiError(400, "invalid-body");
  // Invalid UIDs still record feedback for an otherwise valid pending command.
  let uid: string | null = null;
  try { uid = canonicalUid(body.uid); } catch (error) { if (!(error instanceof ApiError)) throw error; }
  const identity = { origin: `device:${ENTRANCE_DEVICE_ID}`, eventId: event, requestedAt: body.requestedAt };
  const digest = fingerprint(["enrollment-v1", identity.origin, assignmentId, body.uid, body.requestedAt]);
  const db = adminDb();
  const auditRef = db.collection("rfidCardChanges").doc();
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const deviceRef = db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`);
    const device = (await tx.get(deviceRef)).data() as RfidDevice | undefined;
    assertDeviceCurrent(request, device);
    const receipt = await readReceipt(tx, db, identity, digest, now, ENROLLMENT_RECOVERY_MS);
    if (receipt.existing) return receipt.existing;
    const assignmentRef = db.doc(`rfidAssignments/${assignmentId}`);
    const assignment = (await tx.get(assignmentRef)).data() as RfidAssignment | undefined;
    if (!assignment || assignment.deviceId !== ENTRANCE_DEVICE_ID) throw new ApiError(409, "command-mismatch");
    const pending = assignment.status === "pending";
    const expired = pending && assignment.expiresAt.toMillis() <= now;
    const owned = device!.activeAssignmentId === assignmentId;
    const personRef = db.doc(`persons/${assignment.personId}`);
    const person = pending && !expired && owned ? (await tx.get(personRef)).data() : undefined;
    const previous = person?.rfidTagId ?? null;
    const cardRef = uid ? db.doc(`rfidCards/${uid}`) : null;
    const card = cardRef && person ? (await tx.get(cardRef)).data() as RfidCard | undefined : undefined;
    const oldRef = previous ? db.doc(`rfidCards/${canonicalUid(previous)}`) : null;
    const old = oldRef && person ? (await tx.get(oldRef)).data() as RfidCard | undefined : undefined;
    let code = "rfid-assigned";
    if (!pending) code = `assignment-${assignment.status}`;
    else if (expired) code = "assignment-expired";
    else if (!owned) code = "command-mismatch";
    else if (!person || person.deletingAt != null) code = "person-unavailable";
    else if (!uid) code = "invalid-uid";
    else if (assignment.operation !== "assign" && assignment.operation !== "replace") code = "invalid-operation";
    else if (previous !== assignment.expectedPreviousUid) code = "binding-changed";
    else if (card && card.personId !== assignment.personId) code = "card-owned";
    else if (previous && (!old || old.personId !== assignment.personId)) code = "registry-conflict";
    else if (assignment.operation === "assign" && previous && uid !== previous) code = "replace-required";
    else if (assignment.operation === "replace" && !previous) code = "no-card-assigned";
    // An owned-card rejection ends this attempt. Only an explicit admin action
    // may arm another enrollment; the scanner's cooldown cannot end it itself.
    const terminal = code === "rfid-assigned" || code === "card-owned" || expired || code === "person-unavailable";
    if (pending && (owned || expired)) {
      tx.update(assignmentRef, { lastErrorCode: code === "rfid-assigned" ? null : code,
        ...(terminal ? { status: code === "rfid-assigned" ? "completed" : expired ? "expired" : "cancelled" } : {}),
        ...(code === "rfid-assigned" ? { capturedUid: uid, completedAt: stamp(now) } : {}) });
    }
    if (owned && (terminal || !pending)) tx.update(deviceRef, { activeAssignmentId: null, updatedAt: stamp(now) });
    if (code === "rfid-assigned") {
      if (oldRef && previous !== uid) tx.delete(oldRef);
      tx.set(cardRef!, { personId: assignment.personId, assignedAt: card?.assignedAt ?? stamp(now),
        updatedAt: stamp(now), assignedBy: assignment.createdBy } satisfies RfidCard);
      tx.update(personRef, { rfidTagId: uid, updatedAt: stamp(now) });
      if (previous !== uid) tx.set(auditRef, audit(assignment.personId, assignment.operation, previous, uid, assignmentId, assignment.createdBy, now));
      if (previous !== uid) appendAudit(tx, db, { actorId: assignment.createdBy, action: `rfid-card-${assignment.operation}`, entityType: "person", entityId: assignment.personId,
        personId: assignment.personId, operationId: assignmentId, before: { assigned: previous !== null }, after: { assigned: true } });
    }
    const result = makeReceipt(identity, digest, now, { resultCode: code, action: null, logId: null,
      personId: person && person.deletingAt == null ? assignment.personId : null, assignmentId });
    tx.set(receipt.ref, result);
    return result;
  });
}

function audit(personId: string, operation: RfidCardChange["operation"], previousUid: string | null,
  newUid: string | null, assignmentId: string | null, adminUid: string, now: number): RfidCardChange {
  return { personId, operation, previousUid, newUid, assignmentId, adminUid,
    occurredAt: stamp(now), retainUntil: stamp(now + 365 * 86_400_000) };
}

export async function removeCard(adminUid: string, personId: string, expectedPreviousUid: unknown) {
  documentId(personId);
  const expected = canonicalUid(expectedPreviousUid);
  const db = adminDb();
  const auditRef = db.collection("rfidCardChanges").doc();
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const personRef = db.doc(`persons/${personId}`);
    const person = (await tx.get(personRef)).data();
    assertPersonAvailable(person);
    const cardRef = db.doc(`rfidCards/${expected}`);
    const card = (await tx.get(cardRef)).data() as RfidCard | undefined;
    if (person!.rfidTagId == null && !card) return { resultCode: "card-removed" };
    if (person!.rfidTagId !== expected) throw new ApiError(409, "binding-changed");
    if (!card || card.personId !== personId) throw new ApiError(409, "registry-conflict");
    tx.delete(cardRef);
    tx.update(personRef, { rfidTagId: null, updatedAt: stamp(now) });
    tx.set(auditRef, audit(personId, "remove", expected, null, null, adminUid, now));
    appendAudit(tx, db, { actorId: adminUid, action: "rfid-card-removed", entityType: "person", entityId: personId,
      personId, operationId: auditRef.id, before: { assigned: true }, after: { assigned: false } });
    return { resultCode: "card-removed" };
  });
}
