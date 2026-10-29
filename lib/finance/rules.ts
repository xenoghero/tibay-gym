import type { Charge, ChargeKind, GymSettings, PaymentRequest, RateCategory, Rates, RateSnapshot } from "./contracts";

export const DEFAULT_SETTINGS: Readonly<GymSettings> = Object.freeze({
  currency: "PHP", timeZone: "Asia/Manila", weekStartsOn: "Monday",
  studentDailyMinor: 6000, regularDailyMinor: 7000,
  studentMonthlyMinor: null, regularMonthlyMinor: null,
  rateRevision: 0, financialCutoverAt: null, updatedAt: null, updatedBy: null,
});
export function rateCategory(value: unknown): RateCategory | null {
  return value === "student" || value === "regular" ? value : null;
}
export function validateRates(input: Record<string, unknown>): Rates {
  const result = {} as Rates;
  for (const key of ["studentDailyMinor", "regularDailyMinor", "studentMonthlyMinor", "regularMonthlyMinor"] as const) {
    const value = input[key];
    if (value === null && (key === "studentMonthlyMinor" || key === "regularMonthlyMinor")) { result[key] = null; continue; }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 100_000_000) {
      throw new Error("Rates must be positive whole centavos, at most PHP 1,000,000. Monthly rates may be unset.");
    }
    result[key] = value;
  }
  return result;
}
export function parsePesoInput(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter pesos with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 100_000_000) throw new Error("Enter a positive rate up to PHP 1,000,000.");
  return minor;
}
export function snapshotRate(settings: GymSettings, category: unknown, kind: ChargeKind, quantity = 1): RateSnapshot {
  const classified = rateCategory(category);
  if (!classified) throw new Error("An admin must set Student / Regular before a purchase.");
  // Package/custom-expiry pricing has not been agreed: only single-month purchases are defined.
  if (quantity !== 1) throw new Error("Only one daily session or one month has configured pricing.");
  const rates = validateRates(settings as unknown as Record<string, unknown>);
  const key = `${classified}${kind === "daily_session" ? "Daily" : "Monthly"}Minor` as keyof Rates;
  const unitRateMinor = rates[key];
  if (unitRateMinor === null) throw new Error("Set the applicable monthly rate before submitting a membership purchase.");
  return { categorySnapshot: classified, rateRevision: settings.rateRevision, unitRateMinor, quantity, amountMinor: unitRateMinor };
}
export function philippineDate(at: number | Date): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid date.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function mondayStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error("Invalid date.");
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function dailyChargeKey(personId: string, at: number): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(personId)) throw new Error("Invalid customer identifier.");
  return `${personId}_${philippineDate(at)}`;
}
export function operationId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error("Invalid operation identifier.");
  return value;
}
/** Pure reconciliation of source records. Purchase dates and confirmation dates are deliberately separate. */
export function collectionTotals(charges: Charge[], requests: PaymentRequest[], from: string, through: string) {
  const between = (date: string) => date >= from && date <= through;
  const byId = new Map(charges.map(charge => [charge.id, charge]));
  const totals = { expectedMinor: 0, dailyMinor: 0, renewalMinor: 0, newMembershipMinor: 0,
    pendingDailyMinor: 0, pendingRenewalMinor: 0, confirmedMinor: 0, confirmedCount: 0, cashMinor: 0, gcashMinor: 0, otherElectronicMinor: 0 };
  for (const charge of charges) {
    const recognized = charge.kind === "daily_session" ? charge.chargeDate : charge.recognizedPurchaseAt === null ? null : philippineDate(charge.recognizedPurchaseAt);
    if (recognized && between(recognized)) {
      totals.expectedMinor += charge.amountMinor;
      totals[charge.kind === "daily_session" ? "dailyMinor" : charge.kind === "renewal" ? "renewalMinor" : "newMembershipMinor"] += charge.amountMinor;
    }
  }
  const confirmedCharges = new Set<string>();
  const pendingCharges = new Set<string>();
  for (const request of requests) {
    const charge = byId.get(request.chargeId);
    if (!charge) continue;
    if (request.status === "pending" && between(charge.chargeDate) && !pendingCharges.has(charge.id)) {
      pendingCharges.add(charge.id);
      totals[charge.kind === "daily_session" ? "pendingDailyMinor" : "pendingRenewalMinor"] += charge.amountMinor;
    }
    if (request.status === "approved" && request.confirmedAt !== null && between(philippineDate(request.confirmedAt)) && !confirmedCharges.has(charge.id)) {
      confirmedCharges.add(charge.id);
      totals.confirmedMinor += request.amountMinor; totals.confirmedCount += 1;
      totals[request.method === "cash" ? "cashMinor" : request.method === "gcash" || request.paymentAccountSnapshot?.kind === "gcash" ? "gcashMinor" : "otherElectronicMinor"] += request.amountMinor;
    }
  }
  return totals;
}
