import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { closeGuardedStaleSession, STALE_SESSION_MS } from "./attendance";
import { appendAudit } from "./audit";
import { randomUUID } from "node:crypto";

export async function sweepStaleSessions(): Promise<number> {
  const snap = await adminDb().collection("attendanceLogs").where("checkOutAt", "==", null).limit(200).get();
  let closed = 0;
  for (const log of snap.docs) {
    const data = log.data();
    if (Date.now() - data.checkInAt.toMillis() >= STALE_SESSION_MS &&
        await closeGuardedStaleSession(data.personId, log.id)) closed++;
  }
  return closed;
}

export async function forceClose(logId: string, actorId = "system"): Promise<void> {
  const db = adminDb();
  const logRef = db.doc(`attendanceLogs/${documentId(logId)}`);
  await db.runTransaction(async (tx) => {
    const log = (await tx.get(logRef)).data();
    if (!log) return;
    const personRef = db.doc(`persons/${documentId(log.personId)}`);
    const person = (await tx.get(personRef)).data();
    const stateRef = db.doc(`attendanceState/${log.personId}`);
    const state = (await tx.get(stateRef)).data();
    if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
    if (!state) throw new ApiError(409, "attendance-not-initialized");
    if (log.checkOutAt !== null) return;
    if (state.openLogId !== logId) throw new ApiError(409, "attendance-state-conflict");
    const stamp = Timestamp.now();
    tx.update(logRef, { checkOutAt: stamp, closedReason: "manual" });
    tx.update(stateRef, { openLogId: null, lastAction: null, lastLogId: null, lastAcceptedScanAt: null, updatedAt: stamp });
    appendAudit(tx, db, { actorId, action: "attendance-close", entityType: "attendanceLog", entityId: logId,
      personId: log.personId, operationId: `close-${logId}`, before: log, after: { checkOutAt: stamp, closedReason: "manual" } });
  });
}

export async function repairVisits(personId: string, deleteLogId?: string, deleteAll = false, actorId = "system") {
  const db = adminDb();
  const personRef = db.doc(`persons/${documentId(personId)}`);
  if (deleteLogId) documentId(deleteLogId);
  const operationId = randomUUID();
  return db.runTransaction(async (tx) => {
    const person = (await tx.get(personRef)).data();
    const stateRef = db.doc(`attendanceState/${personId}`);
    const state = (await tx.get(stateRef)).data();
    const logs = await tx.get(db.collection("attendanceLogs").where("personId", "==", personId));
    if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
    if (!state) throw new ApiError(409, "attendance-not-initialized");
    if (deleteAll && logs.size > 400) throw new ApiError(409, "too-many-visits");
    const survivors = logs.docs.filter((log) => !deleteAll && log.id !== deleteLogId);
    const lastVisitAt = survivors.reduce<Timestamp | null>((latest, log) => {
      const stamp = log.data().checkInAt as Timestamp;
      return !latest || stamp.toMillis() > latest.toMillis() ? stamp : latest;
    }, null);
    for (const log of logs.docs) if (deleteAll || log.id === deleteLogId) tx.delete(log.ref);
    const ids = new Set(survivors.map((log) => log.id));
    const stamp = Timestamp.now();
    tx.update(stateRef, { openLogId: ids.has(state.openLogId) ? state.openLogId : null,
      ...(!ids.has(state.lastLogId) ? { lastLogId: null, lastAction: null, lastAcceptedScanAt: null } : {}), updatedAt: stamp });
    tx.update(personRef, { visitCount: survivors.length, lastVisitAt, updatedAt: stamp });
    if (logs.size !== survivors.length || person.visitCount !== survivors.length || (person.lastVisitAt?.toMillis() ?? null) !== (lastVisitAt?.toMillis() ?? null)) {
      appendAudit(tx, db, { actorId, action: deleteAll ? "attendance-delete-all" : deleteLogId ? "attendance-delete" : "attendance-repair",
        entityType: "person", entityId: personId, personId, operationId, before: person, after: { visitCount: survivors.length, lastVisitAt } });
    }
    return { visitCount: survivors.length, lastVisitAtMs: lastVisitAt?.toMillis() ?? null, deleted: logs.size - survivors.length };
  });
}

/** Freeze first, then bounded retryable cleanup. The person stays frozen on failure. */
export async function deleteProfile(personId: string, actorId = "system"): Promise<void> {
  const db = adminDb();
  const personRef = db.doc(`persons/${documentId(personId)}`);
  await db.runTransaction(async (tx) => {
    const person = (await tx.get(personRef)).data();
    if (!person) return;
    const assignments = await tx.get(db.collection("rfidAssignments").where("personId", "==", personId));
    const cards = await tx.get(db.collection("rfidCards").where("personId", "==", personId));
    const devices = await tx.get(db.collection("rfidDevices"));
    const pending = new Set(assignments.docs.filter((a) => a.data().status === "pending").map((a) => a.id));
    const stamp = Timestamp.now();
    tx.update(personRef, { deletingAt: person.deletingAt ?? stamp, rfidTagId: null, updatedAt: stamp });
    for (const a of assignments.docs) if (pending.has(a.id)) tx.update(a.ref, { status: "cancelled", lastErrorCode: "person-unavailable" });
    for (const device of devices.docs) if (pending.has(device.data().activeAssignmentId)) tx.update(device.ref, { activeAssignmentId: null, updatedAt: stamp });
    for (const card of cards.docs) tx.delete(card.ref);
    tx.set(db.doc(`attendanceState/${personId}`), { openLogId: null, lastLogId: null, lastAction: null, lastAcceptedScanAt: null, updatedAt: stamp });
    if (!person.deletingAt) appendAudit(tx, db, { actorId, action: "profile-delete-requested", entityType: "person", entityId: personId,
      personId, operationId: `delete-${personId}`, before: person, after: { deleted: true } });
  });
  for (const name of ["attendanceLogs", "weightEntries", "statusChanges", "rfidAssignments", "scanResults", "rfidTapEvents", "rfidCardChanges", "smsMessages", "smsAttempts"]) {
    while (true) {
      const rows = await db.collection(name).where("personId", "==", personId).limit(400).get();
      if (rows.empty) break;
      const batch = db.batch();
      rows.docs.forEach((row) => batch.delete(row.ref));
      await batch.commit();
    }
  }
  await db.runTransaction(async (tx) => {
    const remaining = (await tx.get(personRef)).data();
    tx.delete(db.doc(`profileDetails/${personId}`));
    tx.delete(db.doc(`smsContacts/${personId}`));
    tx.delete(db.doc(`attendanceState/${personId}`));
    tx.delete(personRef);
    if (remaining) tx.set(db.doc(`deletedPersonIds/${personId}`), { deletedAt: Date.now() });
    if (remaining) tx.set(db.doc(`artifactDeletionJobs/${personId}`), { createdAt: Date.now() });
    if (remaining) appendAudit(tx, db, { actorId, action: "profile-deleted", entityType: "person", entityId: personId,
      personId, operationId: `delete-${personId}`, after: { deleted: true } });
  });
}
