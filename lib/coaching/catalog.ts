import { packageState } from "./clocks";

/** Coaching package catalog. One price for every Rate category; packages are hidden, never deleted. */
export interface CoachingPackage { id: string; priceMinor: number; sessions: number; validityDays: number; visible: boolean }
export interface CoachingSettings { packages: CoachingPackage[]; revision: number; updatedAt: number | null; updatedBy: string | null }

export const DEFAULT_COACHING: Readonly<CoachingSettings> = Object.freeze({
  packages: [
    { id: "pkg-4", priceMinor: 75_000, sessions: 4, validityDays: 7, visible: true },
    { id: "pkg-8", priceMinor: 150_000, sessions: 8, validityDays: 15, visible: true },
    { id: "pkg-12", priceMinor: 300_000, sessions: 12, validityDays: 40, visible: true },
    { id: "pkg-16", priceMinor: 370_000, sessions: 16, validityDays: 45, visible: true },
  ],
  revision: 0, updatedAt: null, updatedBy: null,
});

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


export type PackageStatus = "pending" | "rejected" | "closed" | "approved" | "active" | "used_up" | "expired";
/** A client's package: catalog values copied at purchase time, so later catalog edits never change it. */
export interface ClientPackage {
  id: string; personId: string; chargeId: string; paymentRequestId: string; packageId: string;
  priceMinor: number; sessions: number; validityDays: number; status: PackageStatus;
  submittedAt: number; approvedAt: number | null; startedAt: number | null; coachingExpiresAt: number | null;
  sessionsUsed: number; topUpSessions: number; coachId: string | null;
  /** The check-in that started the package, so that visit can say so. */
  startedByLogId?: string | null;
}
/** Only one package at a time: pending, approved-not-started, or active with sessions left and not expired. */
export const blocksNewPackage = (record: ClientPackage, now: number) => ["pending", "approved", "active"].includes(packageState(record, now).status);
