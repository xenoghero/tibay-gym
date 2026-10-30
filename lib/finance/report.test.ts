import { expect, it } from "vitest";
import { AT, chargeFixture, paymentFixture } from "@/tests/finance-fixtures";
import { buildFinanceReport, reportRange } from "./report";
const day = (date = "2026-10-26") => reportRange(new URLSearchParams({ date }));
it("keeps bank collections out of the GCash subtotal and shows the submitted account name", () => {
  const charge = chargeFixture("bank", { confirmedPaymentRequestId: "bank-pay" });
  const payment = paymentFixture("bank-pay", charge, { method: "account_bank0001", status: "approved", confirmedAt: AT,
    paymentAccountSnapshot: { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678" } });
  const report = buildFinanceReport([charge], [payment], day());
  expect(report.totals).toMatchObject({ confirmedMinor: 6000, gcashMinor: 0, cashMinor: 0, otherElectronicMinor: 6000 });
  expect(report.ledger[0].paymentMethodLabel).toBe("BPI savings");
});
it("uses Philippine midnight, Monday weeks, leap months and bounded valid custom periods", () => {
  expect(reportRange(new URLSearchParams(), Date.parse("2026-10-25T16:00:00Z"))).toEqual(day());
  expect(day().startMs).toBe(Date.parse("2026-10-25T16:00:00Z"));
  expect(day().endMs).toBe(Date.parse("2026-10-26T15:59:59.999Z"));
  expect(reportRange(new URLSearchParams({ period: "week", date: "2026-10-25" }))).toMatchObject({ from: "2026-10-19", through: "2026-10-25" });
  expect(reportRange(new URLSearchParams({ period: "month", date: "2028-02-23" }))).toMatchObject({ from: "2028-02-01", through: "2028-02-29" });
  for (const query of ["date=2026-02-30", "period=invalid", "period=custom&from=2026-10-26&through=2026-10-25", "period=custom&from=2025-01-01&through=2026-01-02"]) expect(() => reportRange(new URLSearchParams(query))).toThrow();
});
it("reconciles snapshots, rejected expected charges, delayed confirmation and pending renewals across dates", () => {
  const daily = chargeFixture("daily"), regular = chargeFixture("regular", { amountMinor: 7000, categorySnapshot: "regular", activePaymentRequestId: "rejected" });
  const renewal = chargeFixture("renew", { kind: "renewal", amountMinor: 100000, chargeDate: "2026-10-25" });
  const newMember = chargeFixture("new", { kind: "new_membership", amountMinor: 120000, chargeDate: "2026-10-25", recognizedPurchaseAt: AT, confirmedPaymentRequestId: "approved" });
  const delayed = chargeFixture("delayed", { chargeDate: "2026-10-24", amountMinor: 5500, confirmedPaymentRequestId: "delayed-pay" });
  const charges = [daily, regular, renewal, newMember, delayed];
  const payments = [paymentFixture("pending", daily), paymentFixture("rejected", regular, { status: "rejected" }), paymentFixture("renew-pay", renewal),
    paymentFixture("approved", newMember, { status: "approved", confirmedAt: AT, method: "gcash" }), paymentFixture("delayed-pay", delayed, { status: "approved", confirmedAt: AT })];
  const report = buildFinanceReport(charges, payments, day());
  expect(report.totals).toMatchObject({ expectedMinor: 133000, expectedCount: 3, confirmedMinor: 125500, confirmedCount: 2, pendingDailyMinor: 6000, pendingRenewalMinor: 0, pendingCount: 1, cashMinor: 5500, gcashMinor: 120000 });
  expect(report.outstanding).toEqual({ dailyMinor: 6000, renewalMinor: 100000, newMembershipMinor: 0, count: 2 });
  expect(report.trend[0]).toMatchObject({ expectedMinor: 133000, confirmedMinor: 125500 });
  expect(report.breakdown.reduce((sum, row) => sum + row.expectedMinor, 0)).toBe(report.totals.expectedMinor);
  expect(report.ledger.find(row => row.id === delayed.id)).toMatchObject({ expectedInPeriod: false, confirmedInPeriod: true });
  expect(report.ledger.find(row => row.id === regular.id)?.status).toBe("rejected");
  expect(report.ledger.some(row => row.id === renewal.id)).toBe(false);
});
it("withholds inconsistent joins, duplicate approvals, pending/approved overlap and malformed amounts", () => {
  const c = chargeFixture("daily"), p = paymentFixture("pay", c, { status: "approved", confirmedAt: AT });
  for (const payments of [[{ ...p, personId: "someone-else" }], [{ ...p, amountMinor: 1 }], [p, { ...p, id: "duplicate" }], [p, paymentFixture("pending", c)]]) expect(() => buildFinanceReport([c], payments, day())).toThrow("financial-data-conflict");
  expect(() => buildFinanceReport([{ ...c, amountMinor: NaN }], [], day())).toThrow();
  expect(buildFinanceReport([], [], day()).totals.expectedMinor).toBe(0);
});
