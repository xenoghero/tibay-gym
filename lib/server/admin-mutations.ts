import "server-only";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { operationId } from "@/lib/finance/rules";
import { appendAudit } from "./audit";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import { registrationFields } from "@/lib/registration";
import { rateCategory } from "@/lib/finance/rules";
import { preparePurchase } from "./purchases";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid-input");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "invalid-input");
  return value.trim();
}
function timestamp(value: unknown, nullable = true): Timestamp | null {
  if (value === null && nullable) return null;
  const ms = record(value).$timestamp;
  if (typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 0 || ms > 253402300799999) throw new ApiError(400, "invalid-date");
  return Timestamp.fromMillis(ms);
}
function profile(input: Record<string, unknown>) {
  const phone = text(input.phone, 11)!;
  if (!/^\d{11}$/.test(phone)) throw new ApiError(400, "invalid-phone");
  if (input.type !== "member" && input.type !== "guest") throw new ApiError(400, "invalid-input");
  if (input.type === "member" && input.status !== "active" && input.status !== "expired") throw new ApiError(400, "invalid-input");
  return { phone, name: text(input.name, 160), type: input.type,
    status: input.type === "guest" ? null : input.status,
    membershipExpiry: input.type === "guest" ? null : timestamp(input.membershipExpiry),
    joinDate: input.type === "guest" ? null : timestamp(input.joinDate) };
}
const actions = new Set(["profile-create", "profile-update", "profile-details", "profile-details-delete", "convert", "revert-conversion", "renew", "status",
  "weight-create", "weight-update", "weight-delete", "weight-delete-all", "status-delete-all"]);
export async function mutateAdmin(actorId: string, body: Record<string, unknown>) {
  const action = text(body.action, 50)!;
  if (!actions.has(action)) throw new ApiError(400, "invalid-operation");
  let id: string;
  try { id = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const db = adminDb();
  const receiptRef = db.doc(`adminOperations/${id}`);
  const createdId = createHash("sha256").update(`${actorId}:${id}`).digest("hex").slice(0, 32);
  const input = body.input === undefined ? {} : record(body.input);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(receiptRef)).data();
    if (prior) {
      if (prior.actorId !== actorId || prior.digest !== digest) throw new ApiError(409, "operation-conflict");
      return prior.result;
    }
    let personId = action === "profile-create" ? createdId : body.personId ? documentId(body.personId) : "";
    const weightRef = action === "weight-update" || action === "weight-delete" ? db.doc(`weightEntries/${documentId(body.id)}`) : null;
    const weight = weightRef ? (await tx.get(weightRef)).data() : null;
    if (weightRef && !weight) throw new ApiError(404, "weight-unavailable");
    if (weight) personId = documentId(weight.personId);
    if (!personId) throw new ApiError(400, "invalid-input");
    const personRef = db.doc(`persons/${personId}`);
    const person = (await tx.get(personRef)).data();
    if (action !== "profile-create" && (!person || person.deletingAt)) throw new ApiError(409, "person-unavailable");
    const now = Timestamp.now();
    let after: Record<string, unknown> = {}, reason: string | null = null;
    let result: unknown = { ok: true };
    let entityType = "person", entityId = personId;
    if (action === "profile-create" || action === "profile-update") {
      after = profile(input);
      if (action === "profile-create") {
        try { Object.assign(after, registrationFields(input)); } catch { throw new ApiError(400, "registration-fields-required"); }
      } else {
        const category = rateCategory(input.rateCategory);
        if (input.rateCategory !== undefined && !category) throw new ApiError(400, "category-required");
        if (category) after.rateCategory = category;
      }
      const duplicate = await tx.get(db.collection("persons").where("phone", "==", after.phone));
      const pending = await tx.get(db.collection("unverifiedPersons").where("phone", "==", after.phone));
      if (duplicate.docs.some(doc => doc.id !== personId) || !pending.empty) throw new ApiError(409, "phone-conflict");
      let details: Record<string, unknown> | null = null;
      if (body.details !== undefined) {
        const raw = record(body.details);
        details = { personId, address: text(raw.address, 500, true), birthDate: timestamp(raw.birthDate), updatedAt: now };
      }
      const createMembership = action === "profile-create" && after.type === "member";
      const initialPerson = { ...after, type: "guest", status: null, membershipExpiry: null };
      const stagedPurchase = createMembership ? await preparePurchase(tx, db, actorId, personId, initialPerson,
        { ...(body.financial ? record(body.financial) : {}), method: "cash", operationId: `${id}-purchase` }, true) : null;
      if (createMembership) Object.assign(after, { type: "guest", status: null, membershipExpiry: null, joinDate: null });
      if (action === "profile-update") {
        if (after.type !== person!.type) throw new ApiError(409, "purchase-review-required");
        const changed = (after.membershipExpiry as Timestamp | null)?.toMillis() !== (person!.membershipExpiry?.toMillis() ?? undefined)
          || (after.joinDate as Timestamp | null)?.toMillis() !== (person!.joinDate?.toMillis() ?? undefined) || after.status !== person!.status;
        if (changed) {
          if (typeof body.membershipCorrectionReason !== "string" || !body.membershipCorrectionReason.trim()) throw new ApiError(400, "membership-correction-reason-required");
          reason = text(body.membershipCorrectionReason, 500);
        }
      }
      if (action === "profile-create") {
        tx.set(personRef, { ...after, rfidTagId: null, visitCount: 0, lastVisitAt: null, createdAt: now, updatedAt: now });
        tx.set(db.doc(`attendanceState/${personId}`), { openLogId: null, lastLogId: null, lastAction: null, lastAcceptedScanAt: null, updatedAt: now });
        result = { id: personId };
        if (stagedPurchase) { stagedPurchase.commit(); result = { id: personId, paymentRequestId: stagedPurchase.result.id }; }
      } else tx.update(personRef, { ...after, updatedAt: now });
      if (details) tx.set(db.doc(`profileDetails/${personId}`), details);
      after.changedFields = [...Object.keys(after), ...(details ? ["address", "birthDate"] : [])];
    } else if (action === "profile-details" || action === "profile-details-delete") {
      const ref = db.doc(`profileDetails/${personId}`);
      if (action === "profile-details-delete") tx.delete(ref);
      else tx.set(ref, { personId, address: text(input.address, 500, true), birthDate: timestamp(input.birthDate), updatedAt: now });
      after = { changedFields: ["address", "birthDate"], deleted: action === "profile-details-delete" };
    } else if (action === "convert" || action === "revert-conversion") {
      throw new ApiError(409, "purchase-review-required");
    } else if (action === "renew" || action === "status") {
      if (person!.type !== "member") throw new ApiError(409, "person-unavailable");
      if (body.expectedStatus !== person!.status || (body.expectedExpiryMs ?? null) !== (person!.membershipExpiry?.toMillis() ?? null)) throw new ApiError(409, "membership-changed");
      if (action === "renew") {
        throw new ApiError(409, "purchase-review-required");
      } else {
        if (body.toStatus !== "active" && body.toStatus !== "expired") throw new ApiError(400, "invalid-input");
        reason = text(body.reason, 500); after = { status: body.toStatus };
      }
      tx.update(personRef, { ...after, updatedAt: now });
      tx.set(db.doc(`statusChanges/${createdId}`), { personId, fromStatus: effectiveMemberStatusAt({ type: person!.type, status: person!.status, membershipExpiry: person!.membershipExpiry ?? null }, Date.now()),
        toStatus: after.status, reason, changedAt: now, previousExpiry: person!.membershipExpiry ?? null, newExpiry: after.membershipExpiry ?? person!.membershipExpiry ?? null });
    } else if (action.startsWith("weight-")) {
      entityType = "weightEntry"; entityId = weightRef?.id ?? createdId;
      if (action === "weight-delete-all") {
        const rows = await tx.get(db.collection("weightEntries").where("personId", "==", personId));
        if (rows.size > 400) throw new ApiError(409, "too-many-records");
        rows.docs.forEach(row => tx.delete(row.ref)); result = { count: rows.size };
        after = { deleted: true, weightEntryCount: rows.size };
      } else if (action === "weight-delete") { tx.delete(weightRef!); after = { deleted: true }; }
      else {
        if (typeof input.weightKg !== "number" || !Number.isFinite(input.weightKg) || input.weightKg <= 0 || input.weightKg > 1000) throw new ApiError(400, "invalid-weight");
        const measuredAt = timestamp(input.measuredAt, false);
        const weightKg = Math.round(input.weightKg * 10) / 10;
        if (weightKg <= 0) throw new ApiError(400, "invalid-weight");
        if (weightRef) tx.update(weightRef, { weightKg, measuredAt, updatedAt: now });
        else tx.set(db.doc(`weightEntries/${createdId}`), { personId, weightKg, measuredAt, createdAt: now, updatedAt: now });
        after = { changedFields: ["weightKg", "measuredAt"] }; result = { id: entityId };
      }
    } else if (action === "status-delete-all") {
      const rows = await tx.get(db.collection("statusChanges").where("personId", "==", personId));
      if (rows.size > 400) throw new ApiError(409, "too-many-records");
      rows.docs.forEach(row => tx.delete(row.ref)); result = { count: rows.size }; after = { deleted: true };
    }
    appendAudit(tx, db, { actorId, action, entityType, entityId, personId, operationId: id,
      before: entityType === "person" ? person : null, after, reason });
    tx.set(receiptRef, { actorId, digest, result, createdAt: now });
    return result;
  });
}
