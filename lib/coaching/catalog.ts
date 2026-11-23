import { packageState } from "./clocks";

/** Coaching package catalog. One price for every Rate category; packages are hidden, never deleted. */
export interface CoachingPackage { id: string; priceMinor: number; sessions: number; validityDays: number; visible: boolean }
export interface CoachingSettings {
  packages: CoachingPackage[];
  /** Session top-ups: one price per session, and the validity of top-ups bought without an active package. */
  topUpPriceMinor: number; topUpValidityDays: number;
  revision: number; updatedAt: number | null; updatedBy: string | null;
}

export const DEFAULT_COACHING: Readonly<CoachingSettings> = Object.freeze({
  packages: [
    { id: "pkg-4", priceMinor: 75_000, sessions: 4, validityDays: 7, visible: true },
    { id: "pkg-8", priceMinor: 150_000, sessions: 8, validityDays: 15, visible: true },
    { id: "pkg-12", priceMinor: 300_000, sessions: 12, validityDays: 40, visible: true },
    { id: "pkg-16", priceMinor: 370_000, sessions: 16, validityDays: 45, visible: true },
  ],
  topUpPriceMinor: 25_000, topUpValidityDays: 30,
  revision: 0, updatedAt: null, updatedBy: null,
});

export function validateTopUps(input: Record<string, unknown>) {
  if (!whole(input.topUpPriceMinor, 100_000_000) || !whole(input.topUpValidityDays, 366)) throw new Error("invalid-top-up-settings");
  return { topUpPriceMinor: input.topUpPriceMinor as number, topUpValidityDays: input.topUpValidityDays as number };
}
export const MAX_TOP_UP_SESSIONS = 50;

const whole = (value: unknown, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;

/** Validates an edited catalog against the saved one: every saved package must still be present. */
export function validateCatalog(input: unknown, saved: CoachingPackage[]): CoachingPackage[] {
  if (!Array.isArray(input) || input.length > 30) throw new Error("invalid-coaching-packages");
  const packages = input.map(raw => {
    const item = (raw ?? {}) as Record<string, unknown>;
    if (typeof item.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(item.id) || !whole(item.priceMinor, 100_000_000) || !whole(item.sessions, 200)
      || !whole(item.validityDays, 366) || typeof item.visible !== "boolean") throw new Error("invalid-coaching-packages");
    return { id: item.id, priceMinor: item.priceMinor as number, sessions: item.sessions as number, validityDays: item.validityDays as number, visible: item.visible };
  });
  const ids = new Set(packages.map(item => item.id));
  if (ids.size !== packages.length) throw new Error("invalid-coaching-packages");
  if (saved.some(item => !ids.has(item.id))) throw new Error("coaching-package-delete-forbidden");
  return packages;
}


export interface Freeze { status: "requested" | "active" | "ended" | "rejected" | "dropped"; requestedAt: number; startedAt: number | null; endedAt: number | null; days: number | null }
export type PackageStatus = "pending" | "rejected" | "closed" | "approved" | "active" | "used_up" | "expired";
/** A client's package: catalog values copied at purchase time, so later catalog edits never change it. */
export interface ClientPackage {
  id: string; personId: string; chargeId: string; paymentRequestId: string; packageId: string;
  priceMinor: number; sessions: number; validityDays: number; status: PackageStatus;
  submittedAt: number; approvedAt: number | null; startedAt: number | null; coachingExpiresAt: number | null;
  sessionsUsed: number; topUpSessions: number;
  /** Freeze of a started package: requested, then approved (active) until unfrozen or 14 days pass. At most once per package. */
  freeze?: Freeze | null;
  /** A standalone Session top-up holding (no package): coaching only, never frozen, never blocks a package. */
  topUp?: boolean;
  /** The check-in that started the package, so that visit can say so. */
  startedByLogId?: string | null;
}
/** Only one package at a time: pending, approved-not-started, or active with sessions left and not expired. */
export const blocksNewPackage = (record: ClientPackage, now: number) => !record.topUp && ["pending", "approved", "active"].includes(packageState(record, now).status);

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = typeof WEEKDAYS[number];
export const TIME_SLOTS = { morning: "6 AM–12 PM", afternoon: "12 PM–6 PM", evening: "6 PM–10 PM" } as const;
export type TimeSlot = keyof typeof TIME_SLOTS;
/** Coaching sign-up details kept on the profile; the Preferred schedule is a preference, not a booking. */
export interface CoachingProfile { fbName: string; goals: string | null; startDate: string; preferredSchedule: { weekdays: Weekday[]; timeSlot: TimeSlot }; remarks: string | null }
/** One coach per client. */
export interface CoachAssignment { personId: string; coachId: string; assignedAt: number; assignedBy: string }
