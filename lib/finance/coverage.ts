import type { Coverage } from "./contracts";
import { membershipMonths, philippineDate } from "./rules";
export interface MembershipSnapshot { type: string; status: string | null; expiryMs: number | null }
export function snapshotMembership(person: { type?: unknown; status?: unknown; membershipExpiry?: { toMillis(): number } | null }): MembershipSnapshot {
  return { type: String(person.type), status: typeof person.status === "string" ? person.status : null, expiryMs: person.membershipExpiry?.toMillis() ?? null };
}
export function membershipCoverage(snapshot: MembershipSnapshot, at: number, months = 1): Coverage {
  membershipMonths(months);
  const startDate = philippineDate(snapshot.type === "member" && snapshot.expiryMs !== null && snapshot.expiryMs > at ? snapshot.expiryMs : at);
  const date = new Date(`${startDate}T00:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return { startDate, expiryDate: date.toISOString().slice(0, 10), months };
}
export const coverageExpiryMs = (coverage: Coverage) => Date.parse(`${coverage.expiryDate}T00:00:00+08:00`);
