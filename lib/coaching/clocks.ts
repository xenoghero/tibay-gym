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

/**
 * What a client has to use now. `record` is where the next Coaching session comes from: whatever expires soonest,
 * the package before top-ups on equal expiry. `sessionsLeft` counts every usable package and top-up holding.
 */
export function currentPackage(records: ClientPackage[], now: number) {
  const candidates = records.filter(row => row.status === "approved" || row.status === "active").map(record => ({ record, ...packageState(record, now) }));
  const usable = candidates.filter(row => (row.status === "approved" || row.status === "active") && row.sessionsLeft > 0)
    .sort((a, b) => (effectiveExpiry(a.record, now) ?? Infinity) - (effectiveExpiry(b.record, now) ?? Infinity) || Number(!!a.record.topUp) - Number(!!b.record.topUp));
  const shown = usable[0] ?? candidates.filter(row => !row.record.topUp).sort((a, b) => b.record.submittedAt - a.record.submittedAt)[0] ?? candidates[0];
  return shown ? { ...shown, sessionsLeft: usable.reduce((sum, row) => sum + row.sessionsLeft, 0), holdings: usable } : null;
}

export const FREEZE_MAX_DAYS = 14;
const manilaDayNumber = (ms: number) => Date.parse(`${philippineDate(ms)}T00:00:00Z`) / DAY_MS;
/** Days frozen: end date − start date in Manila calendar days, at least 1. */
export const freezeDays = (startedAt: number, endedAt: number) => Math.max(1, manilaDayNumber(endedAt) - manilaDayNumber(startedAt));
/** A Freeze ends by itself at Manila midnight 14 days after the day it was approved. */
export const freezeAutoEnd = (startedAt: number) => Date.parse(`${addManilaDays(philippineDate(startedAt), FREEZE_MAX_DAYS)}T00:00:00+08:00`);

type Clocked = Pick<ClientPackage, "status" | "sessions" | "topUpSessions" | "sessionsUsed" | "coachingExpiresAt" | "freeze">;
/** Coaching expiry including a Freeze still running (saved ended Freezes are already in coachingExpiresAt). */
export function effectiveExpiry(record: Clocked, now: number) {
  const freeze = record.freeze;
  if (record.coachingExpiresAt === null || freeze?.status !== "active" || freeze.startedAt === null) return record.coachingExpiresAt;
  return record.coachingExpiresAt + freezeDays(freeze.startedAt, Math.min(now, freezeAutoEnd(freeze.startedAt))) * DAY_MS;
}

/** Effective status: unused sessions expire with the coaching validity; a running Freeze pauses coaching. */
export function packageState(record: Clocked, now: number): { status: PackageStatus; sessionsLeft: number; frozen?: true } {
  const left = Math.max(0, record.sessions + record.topUpSessions - record.sessionsUsed);
  if (record.status !== "active") return { status: record.status, sessionsLeft: left };
  const expiry = effectiveExpiry(record, now);
  if (expiry !== null && now >= expiry) return { status: "expired", sessionsLeft: 0 };
  const frozen = record.freeze?.status === "active" && record.freeze.startedAt !== null && now < freezeAutoEnd(record.freeze.startedAt);
  const state = left ? { status: "active" as const, sessionsLeft: left } : { status: "used_up" as const, sessionsLeft: 0 };
  return frozen ? { ...state, frozen: true } : state;
}
