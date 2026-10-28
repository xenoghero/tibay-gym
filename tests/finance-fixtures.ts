import type { Charge, PaymentRequest } from "@/lib/finance/contracts";
export const AT = Date.parse("2026-10-26T01:00:00Z");
export const chargeFixture = (id: string, extra: Partial<Charge> = {}): Charge => ({
  id, personId: "deleted-customer", kind: "daily_session", chargeDate: "2026-10-26", createdAt: AT, recognizedPurchaseAt: null,
  amountMinor: 6000, unitRateMinor: 6000, quantity: 1, categorySnapshot: "student", rateRevision: 1, requestedCoverage: null, approvedCoverage: null,
  dailyVisitDate: "2026-10-26", attendanceLogId: "visit", uniqueDailyKey: id, operationId: id, tibayTransactionNumber: `TB-${id}`, ...extra,
});
export const paymentFixture = (id: string, charge: Charge, extra: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id, chargeId: charge.id, personId: charge.personId, amountMinor: charge.amountMinor, method: "cash", status: "pending", receiptId: null,
  submittedAt: AT, previousRequestId: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, confirmedAt: null, appliedCoverage: null,
  gcashReferenceSnapshot: null, operationId: id, ...extra,
});
