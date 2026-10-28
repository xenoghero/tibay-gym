import type { Charge, ChargeKind, PaymentRequest } from "./contracts";
import { collectionTotals, mondayStart, philippineDate } from "./rules";

export interface ReportRange { from: string; through: string; startMs: number; endMs: number }
export function validFinancialDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("invalid-report-date");
  return value;
}
export function shiftFinancialDate(date: string, days: number): string {
  const value = new Date(`${validFinancialDate(date)}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function reportRange(params: URLSearchParams, now = Date.now()): ReportRange {
  const period = params.get("period") ?? "day", date = validFinancialDate(params.get("date") ?? philippineDate(now));
  let from = date, through = date;
  if (period === "week") { from = mondayStart(date); through = shiftFinancialDate(from, 6); }
  else if (period === "month") { from = `${date.slice(0, 7)}-01`; const last = new Date(`${from}T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0); through = last.toISOString().slice(0, 10); }
  else if (period === "custom") { from = validFinancialDate(params.get("from") ?? date); through = validFinancialDate(params.get("through") ?? date); }
  else if (period !== "day") throw new Error("invalid-report-period");
  if (through < from || Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 365 * 86400000) throw new Error("invalid-report-range");
  return { from, through, startMs: Date.parse(`${from}T00:00:00+08:00`), endMs: Date.parse(`${through}T23:59:59.999+08:00`) };
}
export interface FinanceLedgerRow {
  id: string; personId: string; kind: ChargeKind; category: string; transactionNumber: string; amountMinor: number;
  purchaseDate: string; confirmedAt: number | null; method: "cash" | "gcash" | null;
  status: "pending" | "approved" | "rejected" | "no-submission"; expectedInPeriod: boolean; confirmedInPeriod: boolean; activityAt: number;
}
export interface FinanceReport {
  range: ReportRange;
  totals: ReturnType<typeof collectionTotals> & { expectedCount: number; pendingCount: number; pendingCashMinor: number; pendingGcashMinor: number };
  outstanding: { dailyMinor: number; renewalMinor: number; newMembershipMinor: number; count: number };
  breakdown: Array<{ kind: ChargeKind; expectedMinor: number; expectedCount: number; confirmedMinor: number; confirmedCount: number }>;
  trend: Array<{ date: string; expectedMinor: number; confirmedMinor: number; confirmedCount: number }>;
  ledger: FinanceLedgerRow[];
}
/** Reports use stored money/category snapshots. Current rates and profiles are deliberately not inputs. */
export function buildFinanceReport(charges: Charge[], requests: PaymentRequest[], range: ReportRange): FinanceReport {
  const byId = new Map(charges.map(charge => [charge.id, charge]));
  const between = (date: string) => date >= range.from && date <= range.through;
  const purchaseDate = (charge: Charge) => charge.kind === "daily_session" ? charge.chargeDate : charge.recognizedPurchaseAt === null ? null : philippineDate(charge.recognizedPurchaseAt);
  const breakdown = (["daily_session", "renewal", "new_membership"] as const).map(kind => ({ kind, expectedMinor: 0, expectedCount: 0, confirmedMinor: 0, confirmedCount: 0 }));
  const kinds = new Map(breakdown.map(row => [row.kind, row]));
  const trend: FinanceReport["trend"] = [];
  for (let date = range.from; date <= range.through; date = shiftFinancialDate(date, 1)) trend.push({ date, expectedMinor: 0, confirmedMinor: 0, confirmedCount: 0 });
  const days = new Map(trend.map(day => [day.date, day]));
  const approved = new Map<string, PaymentRequest>(), pending = new Map<string, PaymentRequest>(), latest = new Map<string, PaymentRequest>();
  const outstanding = { dailyMinor: 0, renewalMinor: 0, newMembershipMinor: 0, count: 0 };
  let pendingCashMinor = 0, pendingGcashMinor = 0, expectedCount = 0, pendingCount = 0;
  for (const charge of charges) {
    if (!Number.isSafeInteger(charge.amountMinor) || charge.amountMinor <= 0 || !kinds.has(charge.kind)) throw new Error("financial-data-conflict");
    validFinancialDate(charge.chargeDate);
    const date = purchaseDate(charge);
    if (date && between(date)) {
      expectedCount++; const row = kinds.get(charge.kind)!; row.expectedMinor += charge.amountMinor; row.expectedCount++;
      days.get(date)!.expectedMinor += charge.amountMinor;
    }
  }
  for (const request of requests) {
    const charge = byId.get(request.chargeId);
    if (!charge || request.personId !== charge.personId || request.amountMinor !== charge.amountMinor || !["cash", "gcash"].includes(request.method)) throw new Error("financial-data-conflict");
    if (!latest.has(charge.id) || latest.get(charge.id)!.submittedAt < request.submittedAt || charge.activePaymentRequestId === request.id) latest.set(charge.id, request);
    if (request.status === "approved") {
      if (request.confirmedAt === null || !Number.isFinite(request.confirmedAt) || approved.has(charge.id) || (charge.confirmedPaymentRequestId && charge.confirmedPaymentRequestId !== request.id)) throw new Error("financial-data-conflict");
      approved.set(charge.id, request);
      if (between(philippineDate(request.confirmedAt))) {
        const row = kinds.get(charge.kind)!; row.confirmedMinor += request.amountMinor; row.confirmedCount++;
        const day = days.get(philippineDate(request.confirmedAt))!; day.confirmedMinor += request.amountMinor; day.confirmedCount++;
      }
    } else if (request.status === "pending") {
      if (pending.has(charge.id) || (charge.activePaymentRequestId && charge.activePaymentRequestId !== request.id)) throw new Error("financial-data-conflict");
      pending.set(charge.id, request); outstanding.count++;
      outstanding[charge.kind === "daily_session" ? "dailyMinor" : charge.kind === "renewal" ? "renewalMinor" : "newMembershipMinor"] += request.amountMinor;
      if (between(charge.chargeDate)) { pendingCount++; if (request.method === "cash") pendingCashMinor += request.amountMinor; else pendingGcashMinor += request.amountMinor; }
    } else if (request.status !== "rejected") throw new Error("financial-data-conflict");
  }
  for (const id of pending.keys()) if (approved.has(id)) throw new Error("financial-data-conflict");
  const ledger = charges.flatMap<FinanceLedgerRow>(charge => {
    const date = purchaseDate(charge), expectedInPeriod = !!date && between(date), payment = approved.get(charge.id) ?? pending.get(charge.id) ?? latest.get(charge.id);
    const confirmedInPeriod = !!payment && payment.status === "approved" && payment.confirmedAt !== null && between(philippineDate(payment.confirmedAt));
    if (!expectedInPeriod && !confirmedInPeriod && !between(charge.chargeDate)) return [];
    return [{ id: charge.id, personId: charge.personId, kind: charge.kind, category: charge.categorySnapshot, transactionNumber: charge.tibayTransactionNumber,
      amountMinor: charge.amountMinor, purchaseDate: date ?? charge.chargeDate, confirmedAt: payment?.confirmedAt ?? null,
      method: payment?.method ?? null, status: payment?.status ?? "no-submission", expectedInPeriod, confirmedInPeriod,
      activityAt: confirmedInPeriod ? payment!.confirmedAt! : expectedInPeriod ? charge.recognizedPurchaseAt ?? charge.createdAt : charge.createdAt }];
  }).sort((a, b) => b.activityAt - a.activityAt || a.id.localeCompare(b.id));
  return { range, totals: { ...collectionTotals(charges, requests, range.from, range.through), expectedCount, pendingCount, pendingCashMinor, pendingGcashMinor }, outstanding, breakdown, trend, ledger };
}
