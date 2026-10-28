import { expect, it } from "vitest";
import { collectionTotals, dailyChargeKey, DEFAULT_SETTINGS, mondayStart, parsePesoInput, philippineDate, snapshotRate, validateRates } from "./rules";
import type { Charge, PaymentRequest } from "./contracts";

it("preserves unclassified legacy profiles and refuses missing or invented prices", () => {
  expect(() => snapshotRate({ ...DEFAULT_SETTINGS }, undefined, "daily_session")).toThrow("Student / Regular");
  expect(() => snapshotRate({ ...DEFAULT_SETTINGS }, "student", "renewal")).toThrow("monthly rate");
  expect(() => snapshotRate({ ...DEFAULT_SETTINGS }, "regular", "renewal", 3)).toThrow("Only one");
});
it("snapshots integer money and never reads later settings", () => {
  const settings = { ...DEFAULT_SETTINGS };
  const purchase = snapshotRate(settings, "student", "daily_session");
  settings.studentDailyMinor = 8000;
  expect(purchase).toMatchObject({ categorySnapshot: "student", amountMinor: 6000, rateRevision: 0 });
  expect(snapshotRate(settings, "regular", "daily_session").amountMinor).toBe(7000);
  expect(parsePesoInput("60.01")).toBe(6001);
  expect(parsePesoInput("")).toBeNull();
});
it.each([0, -1, 1.5, Infinity, NaN, "6000", 100_000_001, null])("rejects invalid daily rate %s", value => {
  expect(() => validateRates({ ...DEFAULT_SETTINGS, studentDailyMinor: value })).toThrow();
});
it.each(["1.001", "1e2", "-1", "0", "Infinity"])("rejects invalid peso input %s", value => {
  expect(() => parsePesoInput(value)).toThrow();
});
it("uses Philippine midnight and Monday weeks independently of host time", () => {
  const before = Date.parse("2026-10-25T15:59:59Z"), after = before + 1000;
  expect(philippineDate(before)).toBe("2026-10-25");
  expect(philippineDate(after)).toBe("2026-10-26");
  expect(mondayStart("2026-10-25")).toBe("2026-10-19");
  expect(mondayStart("2026-10-26")).toBe("2026-10-26");
  expect(() => mondayStart("2026-02-30")).toThrow();
  expect(dailyChargeKey("pending-person", after)).toBe("pending-person_2026-10-26");
  expect(dailyChargeKey("pending-person", after + 1000)).toBe(dailyChargeKey("pending-person", after));
});
it("separates expected daily charges, renewal requests, sales and delayed collections", () => {
  const now = Date.parse("2026-10-25T03:00:00Z");
  const charge = (id: string, kind: Charge["kind"], amountMinor: number, recognizedPurchaseAt: number | null): Charge => ({
    id, kind, recognizedPurchaseAt, chargeDate: "2026-10-25", personId: "p1", tibayTransactionNumber: id,
    ...snapshotRate({ ...DEFAULT_SETTINGS }, "student", "daily_session"),
    amountMinor,
    createdAt: now, requestedCoverage: null, approvedCoverage: null, dailyVisitDate: null, attendanceLogId: null, uniqueDailyKey: null, operationId: id,
    // Override daily snapshot with the fixture's amount below.
  });
  const charges = [charge("daily", "daily_session", 6000, null), charge("renewal", "renewal", 100000, null), charge("sale", "new_membership", 120000, now)]
    .map((c, i) => ({ ...c, amountMinor: [6000, 100000, 120000][i] }));
  const request = (id: string, chargeId: string, status: PaymentRequest["status"], amountMinor: number, confirmedAt: number | null): PaymentRequest => ({
    id, chargeId, status, amountMinor, confirmedAt, personId: "p1", method: "cash", receiptId: null, submittedAt: now,
    previousRequestId: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, appliedCoverage: null, gcashReferenceSnapshot: null, operationId: id,
  });
  const requests = [request("a", "daily", "pending", 6000, null), request("b", "renewal", "pending", 100000, null),
    request("c", "sale", "approved", 120000, now + 86400000)];
  expect(collectionTotals(charges, requests, "2026-10-25", "2026-10-25")).toMatchObject({
    expectedMinor: 126000, pendingDailyMinor: 6000, pendingRenewalMinor: 100000, confirmedMinor: 0,
  });
  expect(collectionTotals(charges, requests, "2026-10-26", "2026-10-26")).toMatchObject({ expectedMinor: 0, confirmedMinor: 120000, confirmedCount: 1 });
});
