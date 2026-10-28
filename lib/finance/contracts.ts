/** Non-SMS financial records. All times are epoch milliseconds; money is PHP centavos. */
export type RateCategory = "student" | "regular";
export type LeadSource = "ads" | "facebook" | "google" | "friends" | "signage" | "others";
export type ChargeKind = "daily_session" | "new_membership" | "renewal";
export interface Rates {
  studentDailyMinor: number;
  regularDailyMinor: number;
  studentMonthlyMinor: number | null;
  regularMonthlyMinor: number | null;
}
export interface GymSettings extends Rates {
  currency: "PHP";
  timeZone: "Asia/Manila";
  weekStartsOn: "Monday";
  rateRevision: number;
  financialCutoverAt: number | null;
  updatedAt: number | null;
  updatedBy: string | null;
}
export interface Coverage { startDate: string; expiryDate: string; months: number }
export interface RateSnapshot {
  categorySnapshot: RateCategory;
  rateRevision: number;
  unitRateMinor: number;
  quantity: number;
  amountMinor: number;
}
export interface Charge extends RateSnapshot {
  confirmedPaymentRequestId?: string | null;
  activePaymentRequestId?: string | null;
  id: string;
  tibayTransactionNumber: string;
  personId: string;
  kind: ChargeKind;
  chargeDate: string;
  createdAt: number;
  recognizedPurchaseAt: number | null;
  requestedCoverage: Coverage | null;
  approvedCoverage: Coverage | null;
  dailyVisitDate: string | null;
  attendanceLogId: string | null;
  uniqueDailyKey: string | null;
  operationId: string;
}
export interface PaymentRequest {
  id: string;
  chargeId: string;
  personId: string;
  method: "cash" | "gcash";
  status: "pending" | "approved" | "rejected";
  amountMinor: number;
  receiptId: string | null;
  submittedAt: number;
  previousRequestId: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  rejectionReason: string | null;
  confirmedAt: number | null;
  appliedCoverage: Coverage | null;
  gcashReferenceSnapshot: string | null;
  operationId: string;
}
export interface CustomerSession {
  opaqueSessionHash: string;
  personId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  scope: "renewal-and-status";
}
export interface ReceiptLink { id: string; paymentRequestId: string; personId: string; privateObjectPath: string }
export interface ApprovedGcashReference {
  normalizedReference: string;
  paymentRequestId: string;
  chargeId: string;
  claimedAt: number;
}
