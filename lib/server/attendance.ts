import "server-only";
import type { PaymentMethod } from "@/lib/finance/payment-methods";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import type { AttendanceState, RfidCard, RfidDevice, RfidTapEvent, ScanResult } from "@/lib/rfid/models";
import { ENTRANCE_DEVICE_ID } from "@/lib/rfid/models";
import { assertDeviceCurrent } from "./rfid/auth";
import { ApiError } from "./rfid/http";
import { canonicalUid, documentId, eventId } from "./rfid/validation";
import { fingerprint, makeReceipt, readReceipt } from "./rfid/receipts";
import { reservation } from "./rfid/enrollment";
import type { RegistrationFields } from "@/lib/registration";
import { appendAudit } from "./audit";
import { prepareDailyCharge } from "./daily-charges";

export const RESCAN_WINDOW_MS = 3_000;
export const ATTENDANCE_COOLDOWN_MS = 30_000;
export const STALE_SESSION_MS = 4 * 60 * 60 * 1_000;
type ScanRequest = { eventId: string; requestedAt: number } & (
  { source: "qr"; personId: string; guest?: { phone: string; name: string; address: string } & Partial<RegistrationFields>; intent?: "checkout"; expectedLogId?: string; paymentMethod?: PaymentMethod; paymentRevision?: number; expectedAmountMinor?: number; receiptId?: string; receiptToken?: string; voucherCode?: string; voucherRevision?: number; voucherRateRevision?: number } |
  { source: "rfid"; uid: string; request: Request }
);
interface PersonData {
  type: string; status: "active" | "expired" | null;
  membershipExpiry: Timestamp | null; rfidTagId: string | null; deletingAt?: Timestamp | null;
  visitCount?: number; lastVisitAt?: Timestamp | null;
  rateCategory?: import("@/lib/finance/contracts").RateCategory | null;
}
interface LogData {
  personId: string; source: "qr" | "rfid"; checkInAt: Timestamp;
  checkOutAt: Timestamp | null;
}

/** Trusted server entry point only. HTTP callers must authenticate/throttle first.
 * Profiles with attendance history require a reconciled guard. A new profile
 * initializes its guard atomically with its first visit.
 * No network/display effects belong in the retriable transaction callback.
 */
export async function scanAttendance(input: ScanRequest): Promise<ScanResult> {
  eventId(input.eventId);
  const target = input.source === "qr" ? documentId(input.personId) : canonicalUid(input.uid);
  const checkoutOnly = input.source === "qr" && input.intent === "checkout";
  const expectedLogId = checkoutOnly ? documentId(input.expectedLogId) : null;
  if (checkoutOnly && input.guest) throw new ApiError(400, "invalid-body");
  const identity = { origin: input.source === "qr" ? "qr:attendance" : `device:${ENTRANCE_DEVICE_ID}`,
    eventId: input.eventId, requestedAt: input.requestedAt };
  const digest = fingerprint(["attendance-v1", identity.origin, input.source, target, input.requestedAt,
    ...(input.source === "qr" && input.guest ? [input.guest] : []),
    ...(input.source === "qr" && input.paymentMethod ? [input.paymentMethod, ...(input.paymentRevision !== undefined ? [input.paymentRevision] : [])] : []),
    ...(input.source === "qr" && input.expectedAmountMinor !== undefined ? [input.expectedAmountMinor] : []),
    ...(input.source === "qr" && input.voucherCode ? [input.voucherCode, input.voucherRevision, input.voucherRateRevision] : []),
    ...(input.source === "qr" && input.receiptId ? [input.receiptId, input.receiptToken] : []),
    ...(checkoutOnly ? ["checkout-only-v1", expectedLogId] : [])]);
  const db = adminDb();
  const generatedLogId = db.collection("attendanceLogs").doc().id;
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    let device: RfidDevice | undefined;
    if (input.source === "rfid") {
      device = (await tx.get(db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`))).data() as RfidDevice | undefined;
      assertDeviceCurrent(input.request, device);
    }
    const receipt = await readReceipt(tx, db, identity, digest, now);
    if (receipt.existing) return receipt.existing;
    const command = device ? await reservation(tx, db, device, now) : null;
    let personId: string | null = input.source === "qr" ? target : null;
    if (input.source === "rfid") {
      const card = (await tx.get(db.doc(`rfidCards/${target}`))).data() as RfidCard | undefined;
      personId = card ? documentId(card.personId) : null;
    }
    const officialRef = personId ? db.doc(`persons/${personId}`) : null;
    const official = officialRef ? (await tx.get(officialRef)).data() as PersonData | undefined : undefined;
    // RFID can only resolve official profiles. QR also resolves pending profiles,
    // re-reading both namespaces inside the transaction to serialize approval.
    const pendingRef = personId && input.source === "qr" ? db.doc(`unverifiedPersons/${personId}`) : null;
    const pending = pendingRef ? (await tx.get(pendingRef)).data() as PersonData | undefined : undefined;
    const guest = input.source === "qr" ? input.guest : undefined;
    const unverified = !official && (!!pending || !!guest);
    const personRef = unverified ? pendingRef : officialRef;
    const storedPerson = official ?? pending;
    const logCollection = unverified ? "unverifiedAttendanceLogs" : "attendanceLogs";
    const stateCollection = unverified ? "unverifiedAttendanceState" : "attendanceState";
    const newLog = db.doc(`${logCollection}/${generatedLogId}`);
    const person = storedPerson ?? (guest ? { type: "guest", status: null, membershipExpiry: null, rfidTagId: null } : undefined);
    if (guest) {
      if ((await tx.get(db.doc(`deletedPersonIds/${personId}`))).data()) throw new ApiError(409, "registration-reuse");
      const matching = await tx.get(db.collection("persons").where("phone", "==", guest.phone));
      const matchingPending = await tx.get(db.collection("unverifiedPersons").where("phone", "==", guest.phone));
      if (storedPerson || !matching.empty || !matchingPending.empty) throw new ApiError(409, "guest-conflict");
    }
    const standing = person ? effectiveMemberStatusAt(person, now) : null;
    let rejection: RfidTapEvent["resultCode"] | null = null;
    if (command?.active) rejection = "enrollment-active";
    else if (!personId) rejection = "unknown-card";
    else if (!person || person.deletingAt != null) rejection = "person-unavailable";
    else if (input.source === "rfid" && person.rfidTagId !== target) rejection = "unknown-card";
    else if (input.source === "rfid" && person.type === "member" && standing !== "active") rejection = "expired-member";
    const save = (resultCode: string, action: ScanResult["action"], logId: string | null) => {
      command?.finish();
      const result = makeReceipt(identity, digest, now, { resultCode, action, logId, personId, assignmentId: null });
      tx.set(receipt.ref, result);
      return result;
    };
    if (rejection) {
      // Do not recreate identifying receipts/events after deletion cleanup.
      if (rejection === "person-unavailable") personId = null;
      if (input.source === "rfid") tx.set(db.doc(`rfidTapEvents/${receipt.ref.id}`), {
        deviceId: ENTRANCE_DEVICE_ID, personId, resultCode: rejection, effectiveStatusAtTap: standing,
        occurredAt: Timestamp.fromMillis(now), dismissedAt: null, attendanceLogId: null,
        retainUntil: Timestamp.fromMillis(now + 90 * 86_400_000),
      } satisfies RfidTapEvent);
      return save(rejection, null, null);
    }
    const stateRef = db.doc(`${stateCollection}/${personId}`);
    let state = (await tx.get(stateRef)).data() as AttendanceState | undefined;
    // Admin-created profiles have no private guard yet. Only bootstrap an
    // untouched profile after checking real history, inside this transaction.
    // A missing guard on an existing visitor must still fail closed.
    if (!state && official?.visitCount === 0 && official.lastVisitAt == null && !checkoutOnly) {
      const history = await tx.get(db.collection("attendanceLogs").where("personId", "==", personId).limit(1));
      if (history.empty) state = { openLogId: null, lastAction: null, lastLogId: null,
        lastAcceptedScanAt: null, updatedAt: Timestamp.fromMillis(now) };
    }
    state ??= guest ? { openLogId: null, lastAction: null, lastLogId: null, lastAcceptedScanAt: null,
      updatedAt: Timestamp.fromMillis(now) } : undefined;
    if (!state && !guest) throw new ApiError(409, "attendance-not-initialized");
    const openRef = state!.openLogId ? db.doc(`${logCollection}/${documentId(state!.openLogId)}`) : null;
    const open = openRef ? (await tx.get(openRef)).data() as LogData | undefined : undefined;
    if (openRef && (!open || open.personId !== personId || open.checkOutAt !== null)) {
      throw new ApiError(409, "attendance-state-conflict");
    }
    // Explicit remote checkout never enters the visit-opening/rescan toggle.
    // Expected session is checked transactionally, including retries/concurrent RFID.
    const assertCooldown = () => {
      const lastAccepted = state!.lastAcceptedScanAt?.toMillis();
      if (lastAccepted != null && now - lastAccepted < ATTENDANCE_COOLDOWN_MS) {
        throw new ApiError(429, "attendance-cooldown", Math.ceil((lastAccepted + ATTENDANCE_COOLDOWN_MS - now) / 1000));
      }
    };
    if (checkoutOnly) {
      if (!openRef || !open) return save("no-open-session", null, null);
      if (openRef.id !== expectedLogId) return save("checkout-session-changed", null, null);
      assertCooldown();
      const stamp = Timestamp.fromMillis(now);
      tx.update(openRef, { checkOutAt: stamp, closedReason: now - open.checkInAt.toMillis() >= STALE_SESSION_MS ? "auto" : "implicit" });
      tx.set(stateRef, { openLogId: null, lastLogId: openRef.id, lastAcceptedScanAt: stamp,
        lastAction: "checked-out", updatedAt: stamp } satisfies AttendanceState);
      return save("checked-out", "checked-out", openRef.id);
    }
    if (state!.lastAction && state!.lastLogId && state!.lastAcceptedScanAt &&
        now - state!.lastAcceptedScanAt.toMillis() < RESCAN_WINDOW_MS) {
      return save(state!.lastAction, state!.lastAction, state!.lastLogId);
    }
    assertCooldown();
    const stale = open && now - open.checkInAt.toMillis() >= STALE_SESSION_MS;
    const action = open && !stale ? "checked-out" : "checked-in";
    const commitCharge = action === "checked-in" && (person!.type !== "member" || standing !== "active")
      ? await prepareDailyCharge(tx, db, { personId: personId!, category: guest?.rateCategory ?? storedPerson?.rateCategory,
        at: now, logId: newLog.id, source: input.source, eventId: input.eventId,
        paymentMethod: input.source === "qr" ? input.paymentMethod : undefined,
        paymentRevision: input.source === "qr" ? input.paymentRevision : undefined,
        expectedAmountMinor: input.source === "qr" ? input.expectedAmountMinor : undefined,
        voucherCode: input.source === "qr" ? input.voucherCode : undefined, voucherRevision: input.source === "qr" ? input.voucherRevision : undefined,
        voucherRateRevision: input.source === "qr" ? input.voucherRateRevision : undefined,
        receiptId: input.source === "qr" ? input.receiptId : undefined, receiptToken: input.source === "qr" ? input.receiptToken : undefined }) : () => {};
    const stamp = Timestamp.fromMillis(now);
    if (guest) {
      tx.set(personRef!, { ...person, phone: guest.phone, name: guest.name, joinDate: null,
        rateCategory: guest.rateCategory ?? null, leadSource: guest.leadSource ?? null, leadSourceOther: guest.leadSourceOther ?? null,
        address: guest.address, visitCount: 0, lastVisitAt: null, createdAt: stamp, updatedAt: stamp });
      appendAudit(tx, db, { actorId: `customer:${personId}`, action: "registration-created", entityType: "unverifiedPerson", entityId: personId!,
        personId: personId!, operationId: input.eventId, after: { type: "guest", rateCategory: guest.rateCategory ?? null } });
    }
    if (openRef) tx.update(openRef, { checkOutAt: stamp, closedReason: stale ? "auto" : "implicit" });
    const logId = action === "checked-out" ? openRef!.id : newLog.id;
    if (action === "checked-in") {
      commitCharge();
      tx.set(newLog, { personId, source: input.source, checkInAt: stamp, checkOutAt: null, closedReason: null });
      tx.update(personRef!, { visitCount: FieldValue.increment(1), lastVisitAt: stamp, updatedAt: stamp });
    }
    tx.set(stateRef, { openLogId: action === "checked-in" ? logId : null, lastLogId: logId,
      lastAcceptedScanAt: stamp, lastAction: action, updatedAt: stamp } satisfies AttendanceState);
    return save(action, action, logId);
  });
}

/** Conditional cleanup entry point for phase-four sweeps; never overwrites a newer close. */
export async function closeGuardedStaleSession(personId: string, expectedLogId: string): Promise<boolean> {
  documentId(personId); documentId(expectedLogId);
  const db = adminDb();
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const stateRef = db.doc(`attendanceState/${personId}`);
    const state = (await tx.get(stateRef)).data() as AttendanceState | undefined;
    const logRef = db.doc(`attendanceLogs/${expectedLogId}`);
    const log = (await tx.get(logRef)).data() as LogData | undefined;
    const person = (await tx.get(db.doc(`persons/${personId}`))).data();
    if (!person || person.deletingAt != null || state?.openLogId !== expectedLogId ||
        !log || log.personId !== personId || log.checkOutAt !== null || now - log.checkInAt.toMillis() < STALE_SESSION_MS) return false;
    const stamp = Timestamp.fromMillis(now);
    tx.update(logRef, { checkOutAt: stamp, closedReason: "auto" });
    tx.update(stateRef, { openLogId: null, updatedAt: stamp });
    return true;
  });
}
