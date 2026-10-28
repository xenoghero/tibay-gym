import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { STALE_SESSION_MS } from "./attendance";
import { appendAudit } from "./audit";

/** The profile, entire history, and session guard become official atomically.
 * Scans read the same profile/guard documents, so a concurrent scan retries in
 * the correct namespace. Preserving IDs also preserves outstanding QR receipts.
 */
export async function approveUnverified(personId: string, adminUid: string): Promise<void> {
  documentId(personId);
  const db = adminDb();
  await db.runTransaction(async tx => {
    const pendingRef = db.doc(`unverifiedPersons/${personId}`);
    const officialRef = db.doc(`persons/${personId}`);
    const pending = (await tx.get(pendingRef)).data();
    const official = (await tx.get(officialRef)).data();
    if (!pending) {
      if (official?.verifiedAt) return; // A lost approval response is safe to retry.
      throw new ApiError(404, "registration-unavailable");
    }
    if (pending.deletingAt) throw new ApiError(409, "registration-deleting");
    const duplicate = await tx.get(db.collection("persons").where("phone", "==", pending.phone));
    if (official || !duplicate.empty) throw new ApiError(409, "registration-conflict");
    const stateRef = db.doc(`unverifiedAttendanceState/${personId}`);
    const state = (await tx.get(stateRef)).data();
    const logs = await tx.get(db.collection("unverifiedAttendanceLogs").where("personId", "==", personId));
    if (!state) throw new ApiError(409, "attendance-not-initialized");
    const stamp = Timestamp.now();
    let lastVisitAt: Timestamp | null = null;
    let openLogId = state.openLogId;
    for (const log of logs.docs) {
      const data = log.data();
      if (!lastVisitAt || data.checkInAt.toMillis() > lastVisitAt.toMillis()) lastVisitAt = data.checkInAt;
      // A long-pending visit must not inflate the gym's currently-inside count.
      const stale = data.checkOutAt === null && stamp.toMillis() - data.checkInAt.toMillis() >= STALE_SESSION_MS;
      tx.set(db.doc(`attendanceLogs/${log.id}`), { ...data,
        ...(stale ? { checkOutAt: stamp, closedReason: "auto" } : {}) });
      if (stale && openLogId === log.id) openLogId = null;
      tx.delete(log.ref);
    }
    tx.set(officialRef, {
      phone: pending.phone, name: pending.name, type: "guest", status: null,
      membershipExpiry: null, rfidTagId: null, joinDate: null,
      visitCount: logs.size, lastVisitAt, createdAt: pending.createdAt, updatedAt: stamp,
      verifiedAt: stamp, verifiedBy: adminUid,
      rateCategory: pending.rateCategory ?? null, leadSource: pending.leadSource ?? null,
      leadSourceOther: pending.leadSourceOther ?? null, profileImagePath: pending.profileImagePath ?? null,
    });
    if (pending.address) tx.set(db.doc(`profileDetails/${personId}`), {
      personId, address: pending.address, updatedAt: stamp,
    });
    tx.set(db.doc(`attendanceState/${personId}`), { ...state, openLogId, updatedAt: stamp });
    tx.delete(stateRef);
    tx.delete(pendingRef);
    appendAudit(tx, db, { actorId: adminUid, action: "registration-approved", entityType: "person", entityId: personId,
      personId, operationId: `approve-${personId}`, before: pending, after: { type: "guest", status: null, visitCount: logs.size } });
  });
}

/** Freeze before bounded cleanup. On failure the admin can retry deletion;
 * new scans cannot recreate children while the frozen profile still exists.
 */
export async function deleteUnverified(personId: string, actorId = "system"): Promise<void> {
  documentId(personId);
  const db = adminDb();
  const ref = db.doc(`unverifiedPersons/${personId}`);
  const frozen = await db.runTransaction(async tx => {
    const pending = (await tx.get(ref)).data();
    if (!pending) return false; // Never delete a profile that has been approved.
    tx.update(ref, { deletingAt: pending.deletingAt ?? Timestamp.now() });
    if (!pending.deletingAt) appendAudit(tx, db, { actorId, action: "registration-rejected", entityType: "unverifiedPerson", entityId: personId,
      personId, operationId: `reject-${personId}`, before: pending, after: { deleted: true } });
    return true;
  });
  if (!frozen) return;
  for (const collection of ["unverifiedAttendanceLogs", "scanResults"]) {
    while (true) {
      const rows = await db.collection(collection).where("personId", "==", personId).limit(400).get();
      if (rows.empty) break;
      const batch = db.batch();
      rows.docs.forEach(row => batch.delete(row.ref));
      await batch.commit();
    }
  }
  await db.runTransaction(async tx => {
    const pending = (await tx.get(ref)).data();
    if (!pending?.deletingAt) return;
    tx.delete(db.doc(`unverifiedAttendanceState/${personId}`));
    tx.delete(ref);
    tx.set(db.doc(`deletedPersonIds/${personId}`), { deletedAt: Date.now() });
    tx.set(db.doc(`artifactDeletionJobs/${personId}`), { createdAt: Date.now() });
  });
}
