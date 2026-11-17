import "server-only";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { TIME_SLOTS, WEEKDAYS, type CoachingProfile } from "@/lib/coaching/catalog";
import { addManilaDays } from "@/lib/coaching/clocks";
import { operationId, philippineDate, rateCategory } from "@/lib/finance/rules";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { attendancePhone, attendanceText, onlyFields } from "./attendance-request";
import { appendAudit } from "./audit";

const optional = (value: unknown, max: number) => {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  return attendanceText(value, max);
};

/** Validates the Coaching sign-up link form; the error code names the first invalid field. */
export function signupFields(body: Record<string, unknown>, now = Date.now()) {
  onlyFields(body, ["operationId", "name", "phone", "rateCategory", "fbName", "startDate", "weekdays", "timeSlot", "address", "goals", "remarks"]);
  const missing: string[] = [];
  const text = (key: string, max: number) => { try { return attendanceText(body[key], max); } catch { missing.push(key); return ""; } };
  const name = text("name", 120), fbName = text("fbName", 120);
  let phone = "";
  try { phone = attendancePhone(body.phone); } catch { missing.push("phone"); }
  const category = rateCategory(body.rateCategory);
  if (!category) missing.push("rateCategory");
  const today = philippineDate(now), start = body.startDate;
  if (typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start) || addManilaDays(start, 0) !== start || start < today || start > addManilaDays(today, 365)) missing.push("startDate");
  const weekdays = Array.isArray(body.weekdays) ? [...new Set(body.weekdays)] : [];
  if (!weekdays.length || weekdays.some(day => !WEEKDAYS.includes(day))) missing.push("weekdays");
  if (typeof body.timeSlot !== "string" || !(body.timeSlot in TIME_SLOTS)) missing.push("timeSlot");
  let address: string | null = null, goals: string | null = null, remarks: string | null = null;
  try { address = optional(body.address, 500); goals = optional(body.goals, 500); remarks = optional(body.remarks, 500); } catch { missing.push("optional-too-long"); }
  if (missing.length) throw new ApiError(400, `signup-invalid-${missing[0]}`);
  const profile: CoachingProfile = { fbName, goals, remarks, startDate: start as string,
    preferredSchedule: { weekdays: WEEKDAYS.filter(day => weekdays.includes(day)), timeSlot: body.timeSlot as CoachingProfile["preferredSchedule"]["timeSlot"] } };
  return { name, phone, rateCategory: category!, address, profile };
}

/**
 * Creates an unverified profile from the Coaching sign-up link, tagged with Facebook as the lead source.
 * Refuses a phone already on any profile without touching it. Safe to retry with the same operation id.
 */
export async function createCoachingSignup(body: Record<string, unknown>) {
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const fields = signupFields(body), db = adminDb();
  const personId = `cs-${createHash("sha256").update(operation).digest("hex").slice(0, 40)}`;
  return db.runTransaction(async tx => {
    const ref = db.doc(`unverifiedPersons/${personId}`), existing = (await tx.get(ref)).data();
    if (existing) {
      if (existing.phone !== fields.phone) throw new ApiError(409, "operation-conflict");
      return { personId, phone: fields.phone };
    }
    if ((await tx.get(db.doc(`deletedPersonIds/${personId}`))).data()) throw new ApiError(409, "registration-reuse");
    const official = await tx.get(db.collection("persons").where("phone", "==", fields.phone));
    const pending = await tx.get(db.collection("unverifiedPersons").where("phone", "==", fields.phone));
    if (!official.empty || !pending.empty) throw new ApiError(409, "phone-already-registered");
    const stamp = Timestamp.now();
    tx.set(ref, { phone: fields.phone, phoneLast4: fields.phone.slice(-4), name: fields.name, type: "guest", status: null, membershipExpiry: null,
      rfidTagId: null, joinDate: null, rateCategory: fields.rateCategory, leadSource: "facebook", leadSourceOther: null, address: fields.address ?? "",
      coachingProfile: fields.profile, visitCount: 0, lastVisitAt: null, createdAt: stamp, updatedAt: stamp });
    tx.set(db.doc(`unverifiedAttendanceState/${personId}`), { openLogId: null, lastAction: null, lastLogId: null, lastAcceptedScanAt: null, updatedAt: stamp });
    appendAudit(tx, db, { actorId: `customer:${personId}`, action: "registration-created", entityType: "unverifiedPerson", entityId: personId, personId,
      operationId: operation, after: { type: "guest", rateCategory: fields.rateCategory }, reason: "Coaching sign-up link" });
    return { personId, phone: fields.phone };
  });
}
