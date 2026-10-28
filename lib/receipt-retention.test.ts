import { expect, it } from "vitest";
import { accountingDeletionDate, DEFAULT_RECEIPT_RETENTION as defaults, receiptDeletionDue } from "./receipt-retention";
const now = Date.parse("2032-01-01T00:00:00Z"), reviewedAt = now - 180 * 86400000;
it("keeps pending, unknown, undated and unclassified approved evidence", () => {
  for (const payment of [undefined, { status: "pending", reviewedAt }, { status: "approved", reviewedAt }, { status: "rejected" }])
    expect(receiptDeletionDue(payment, defaults, now)).toBe(false);
});
it("expires rejected evidence at exactly 180 days, with independent dispute/legal protection", () => {
  const payment = { status: "rejected", reviewedAt };
  expect(receiptDeletionDue(payment, defaults, now - 1)).toBe(false);
  expect(receiptDeletionDue(payment, defaults, now)).toBe(true);
  for (const hold of ["disputeHold", "legalHold"]) expect(receiptDeletionDue(payment, { ...defaults, [hold]: true }, now)).toBe(false);
});
it("uses the day following an on-time deadline, or actual late filing, for five calendar years", () => {
  expect(accountingDeletionDate("2026-04-15", "2026-04-10")).toBe(Date.parse("2031-04-16T00:00:00+08:00"));
  expect(accountingDeletionDate("2026-04-15", "2026-05-20")).toBe(Date.parse("2031-05-20T00:00:00+08:00"));
  expect(accountingDeletionDate("2028-02-28", "2028-02-27")).toBe(Date.parse("2033-03-01T00:00:00+08:00"));
  expect(() => accountingDeletionDate("2026-02-30", "2026-03-01")).toThrow();
});
it("expires approved evidence only at its confirmed accounting deadline", () => {
  const policy = { ...defaults, accountingDeleteAfter: now };
  expect(receiptDeletionDue({ status: "approved" }, policy, now - 1)).toBe(false);
  expect(receiptDeletionDue({ status: "approved" }, policy, now)).toBe(true);
});
