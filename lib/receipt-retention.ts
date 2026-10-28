export const REJECTED_RECEIPT_DAYS = 180;
export const RECEIPT_RETENTION_NOTICE = "Your receipt stays private. Rejected or replaced receipts are kept for 180 days after final rejection. Approved receipts follow the applicable five-year accounting period. Pending reviews, disputes and legal requirements can extend retention. Minimal transaction records are kept separately.";
export interface ReceiptRetention {
  revision: number;
  disputeHold: boolean;
  legalHold: boolean;
  filingDeadline: string | null;
  filedAt: string | null;
  accountingDeleteAfter: number | null;
  purgeState?: "purging" | "purged";
}
export const DEFAULT_RECEIPT_RETENTION: ReceiptRetention = {
  revision: 0, disputeHold: false, legalHold: false,
  filingDeadline: null, filedAt: null, accountingDeleteAfter: null,
};
function calendarDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid-filing-date");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("invalid-filing-date");
  return date;
}
/** Owner/bookkeeper supplies the relevant return dates; never infer these from payment time. */
export function accountingDeletionDate(deadline: unknown, filedAt: unknown): number {
  const due = calendarDate(deadline), filed = calendarDate(filedAt);
  const start = filed > due ? filed : new Date(due.getTime() + 86400000);
  // JS rolls Feb 29 forward to March 1 in a non-leap target year, avoiding early removal.
  start.setUTCFullYear(start.getUTCFullYear() + 5);
  return start.getTime() - 8 * 3600000; // midnight Asia/Manila
}
export function receiptDeletionDue(payment: { status?: unknown; reviewedAt?: unknown } | undefined, policy: ReceiptRetention, now: number) {
  if (policy.disputeHold || policy.legalHold || !payment) return false;
  if (payment.status === "approved") return Number.isFinite(policy.accountingDeleteAfter) && policy.accountingDeleteAfter !== null && policy.accountingDeleteAfter <= now;
  return payment.status === "rejected" && typeof payment.reviewedAt === "number" && Number.isFinite(payment.reviewedAt)
    && payment.reviewedAt + REJECTED_RECEIPT_DAYS * 86400000 <= now;
}
