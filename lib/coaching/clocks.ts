import { philippineDate } from "@/lib/finance/rules";
import { membershipCoverage, type MembershipSnapshot } from "@/lib/finance/coverage";
import type { ClientPackage, PackageStatus } from "./catalog";

/** Package clock rules (docs/adr/0001-coaching-package-clocks.md). All calendar dates are Asia/Manila. */
const DAY_MS = 86_400_000;
export const AUTO_START_DAYS = 15;

export const autoStartDeadline = (approvedAt: number) => approvedAt + AUTO_START_DAYS * DAY_MS;

/** The earlier of the first check-in/coaching session and the 15-day automatic start. */
export const packageStartAt = (approvedAt: number, firstUseAt: number) => Math.min(firstUseAt, autoStartDeadline(approvedAt));

export function addManilaDays(date: string, days: number) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Coaching validity runs whole Manila days from the start day; it ends at Manila midnight after the last day. */
export const coachingExpiryMs = (startedAt: number, validityDays: number, daysFrozen = 0) =>
  Date.parse(`${addManilaDays(philippineDate(startedAt), validityDays + daysFrozen)}T00:00:00+08:00`);

/** One month of Monthly membership from the later of Package start and the current membership expiry. */
export const membershipMonth = (membership: MembershipSnapshot, startedAt: number) => membershipCoverage(membership, startedAt, 1);

/** The package a client is using now (approved or active), with its effective status. */
export function currentPackage(records: ClientPackage[], now: number) {
  const record = records.filter(row => row.status === "approved" || row.status === "active").sort((a, b) => b.submittedAt - a.submittedAt)[0];
  return record ? { record, ...packageState(record, now) } : null;
}

/** Effective status: unused sessions expire with the coaching validity. */
export function packageState(record: Pick<ClientPackage, "status" | "sessions" | "topUpSessions" | "sessionsUsed" | "coachingExpiresAt">, now: number): { status: PackageStatus; sessionsLeft: number } {
  const left = Math.max(0, record.sessions + record.topUpSessions - record.sessionsUsed);
  if (record.status !== "active") return { status: record.status, sessionsLeft: left };
  if (record.coachingExpiresAt !== null && now >= record.coachingExpiresAt) return { status: "expired", sessionsLeft: 0 };
  return left ? { status: "active", sessionsLeft: left } : { status: "used_up", sessionsLeft: 0 };
}
