import "server-only";
import { ApiError } from "./rfid/http";
import { isCheckinPhone } from "../checkin-phone";
import { adminDb } from "./firebase-admin";
import { publicRateLimiter } from "./public-rate-limit";

export function attendancePhone(value: unknown): string {
  if (!isCheckinPhone(value)) throw new ApiError(400, "invalid-body");
  return value;
}

/** Existing-account lookups accept the full number or its last 4 digits. Four digits
 * resolve only when exactly one registered number ends in them. */
export async function resolveAccountPhone(value: unknown, caller: string): Promise<string> {
  if (typeof value !== "string" || !/^[0-9]{4}$/.test(value)) return attendancePhone(value);
  publicRateLimiter.consume(caller, "shortPhone");
  const db = adminDb();
  const rows = await Promise.all(["persons", "unverifiedPersons"].map(name =>
    db.collection(name).where("phoneLast4", "==", value).limit(2).get()));
  // The same number can briefly exist in both collections during approval.
  const phones = new Set(rows.flatMap(snapshot => snapshot.docs.map(doc => doc.data().phone as string)));
  if (phones.size === 0) throw new ApiError(404, "phone-not-found");
  if (phones.size > 1) throw new ApiError(409, "phone-ambiguous");
  return [...phones][0];
}

export function attendanceText(value: unknown, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) throw new ApiError(400, "invalid-body");
  return value.trim();
}

export function onlyFields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, "invalid-body");
}

export function attendanceIntent(value: unknown): "attendance" | "checkout" {
  if (value === undefined || value === "attendance") return "attendance";
  if (value === "checkout") return "checkout";
  throw new ApiError(400, "invalid-intent");
}
