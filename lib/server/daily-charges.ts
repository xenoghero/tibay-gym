import "server-only";
import { preparePaymentAccount } from "./payment-methods";
import { isPaymentMethod } from "@/lib/finance/payment-methods";

import type { PaymentMethod } from "@/lib/finance/payment-methods";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Charge, GymSettings, PaymentRequest } from "@/lib/finance/contracts";
import { dailyChargeKey, philippineDate, snapshotRate } from "@/lib/finance/rules";
import { ApiError } from "./rfid/http";
import { appendAudit } from "./audit";
import { adminDb } from "./firebase-admin";
import { documentId } from "./rfid/validation";
import { readyReceipt } from "./receipt-proof";
import { prepareTransactionNumber } from "./transaction-numbers";
import { prepareVoucher, prepareVoucherSettlement } from "./vouchers";

export function dailyChargeId(personId: string, at: number) {
  return `daily-${createHash("sha256").update(dailyChargeKey(personId, at)).digest("hex")}`;
}
/** Reads only; call commit after all attendance transaction reads have finished. */
export async function prepareDailyCharge(tx: Transaction, db: Firestore, input: {
  personId: string; category: unknown; at: number; logId: string; source: "qr" | "rfid";
  paymentMethod?: PaymentMethod; paymentRevision?: number; eventId: string; expectedAmountMinor?: number; receiptId?: string; receiptToken?: string;
  voucherCode?: unknown; voucherRevision?: unknown; voucherRateRevision?: unknown;
}) {
  const settings = (await tx.get(db.doc("gymSettings/finance"))).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt || input.at < settings.financialCutoverAt) return () => {};
  const id = dailyChargeId(input.personId, input.at), ref = db.doc(`charges/${id}`);
  const existing = (await tx.get(ref)).data();
  if (existing) {
    if (input.paymentMethod && input.paymentMethod !== "cash") {
      const proof = await readyReceipt(tx, db, { ...input, chargeId: id, amountMinor: existing.amountMinor });
      if (existing.activePaymentRequestId !== proof.paymentRequestId) throw new ApiError(409, "daily-payment-already-submitted");
    }
    return () => {};
  }
  let price;
  try { price = snapshotRate(settings, input.category, "daily_session"); }
  catch { throw new ApiError(409, "category-required"); }
  if (input.source === "qr" && !isPaymentMethod(input.paymentMethod)) throw new ApiError(409, "daily-payment-required");
  const voucher = input.source === "qr" && input.voucherCode ? await prepareVoucher(tx, db, { code: input.voucherCode, personId: input.personId,
    kind: "daily_session", category: price.categorySnapshot, baseAmountMinor: price.amountMinor, at: input.at }) : null;
  if (voucher && (voucher.voucherSnapshot?.revision !== input.voucherRevision || price.rateRevision !== input.voucherRateRevision)) throw new ApiError(409, "voucher-changed");
  if (voucher) price = { ...price, baseAmountMinor: voucher.baseAmountMinor, discountAmountMinor: voucher.discountAmountMinor, amountMinor: voucher.amountMinor, voucherSnapshot: voucher.voucherSnapshot };
  if (input.source === "qr" && input.expectedAmountMinor !== price.amountMinor) throw new ApiError(409, "daily-price-changed");
  const paymentAccountSnapshot = input.paymentMethod ? await preparePaymentAccount(tx, db, input.paymentMethod, input.paymentRevision) : null;
  const proof = input.paymentMethod && input.paymentMethod !== "cash" ? await readyReceipt(tx, db, { ...input, chargeId: id, amountMinor: price.amountMinor }) : null;
  const number = await prepareTransactionNumber(tx, db);
  const charge: Charge = { id, ...price, personId: input.personId, kind: "daily_session", chargeDate: philippineDate(input.at),
    tibayTransactionNumber: number.number, createdAt: input.at, recognizedPurchaseAt: null, requestedCoverage: null, approvedCoverage: null,
    dailyVisitDate: philippineDate(input.at), attendanceLogId: input.logId, uniqueDailyKey: dailyChargeKey(input.personId, input.at), operationId: input.eventId };
  const requestId = proof?.paymentRequestId ?? `${id}-cash`;
  const payment: PaymentRequest = { id: requestId, chargeId: id, personId: input.personId, method: input.paymentMethod ?? "cash", paymentAccountSnapshot, status: "pending", amountMinor: price.amountMinor,
    receiptId: proof?.receiptId ?? null, submittedAt: input.at, previousRequestId: null, reviewedBy: null, reviewedAt: null, rejectionReason: null,
    confirmedAt: null, appliedCoverage: null, gcashReferenceSnapshot: null, operationId: input.eventId };
  return () => {
    number.commit(); proof?.commit(); voucher?.commit(id, number.number);
    tx.set(ref, { ...charge, activePaymentRequestId: input.paymentMethod ? requestId : null });
    // The scanner has no payment selector: retain the expected charge for reviewed admin collection.
    if (input.paymentMethod) tx.set(db.doc(`paymentRequests/${requestId}`), payment);
    appendAudit(tx, db, { actorId: input.source === "rfid" ? "device:entrance-01" : `customer:${input.personId}`, action: "daily-charge-created", entityType: "charge", entityId: id,
      personId: input.personId, operationId: input.eventId, after: { rateCategory: price.categorySnapshot, amountMinor: price.amountMinor, changedFields: ["dailyCharge", ...(input.paymentMethod ? ["pendingPayment"] : [])] } });
  };
}
export async function confirmDailyCash(actorId: string, chargeId: string, expectedAmountMinor: unknown) {
  const db = adminDb(), ref = db.doc(`charges/${documentId(chargeId)}`);
  return db.runTransaction(async tx => {
    const charge = (await tx.get(ref)).data() as (Charge & { confirmedPaymentRequestId?: string }) | undefined;
    if (!charge || charge.kind !== "daily_session") throw new ApiError(404, "daily-charge-unavailable");
    if (expectedAmountMinor !== charge.amountMinor) throw new ApiError(409, "amount-changed");
    const id = `${chargeId}-cash`, paymentRef = db.doc(`paymentRequests/${id}`);
    const previous = (await tx.get(paymentRef)).data();
    if (charge.activePaymentRequestId && charge.activePaymentRequestId !== id) throw new ApiError(409, "use-payment-review");
    if (charge.confirmedPaymentRequestId) {
      if (charge.confirmedPaymentRequestId === id && previous?.status === "approved") return { ok: true };
      throw new ApiError(409, "charge-already-paid");
    }
    if (previous && previous.status !== "pending") throw new ApiError(409, "payment-not-pending");
    const now = Date.now();
    const settleVoucher = await prepareVoucherSettlement(tx, db, charge, "confirmed", actorId, now);
    const payment: PaymentRequest = { id, chargeId, personId: charge.personId, method: "cash", status: "approved", amountMinor: charge.amountMinor,
      receiptId: null, submittedAt: previous?.submittedAt ?? now, previousRequestId: null, reviewedBy: actorId, reviewedAt: now, rejectionReason: null,
      confirmedAt: now, appliedCoverage: null, gcashReferenceSnapshot: null, operationId: `confirm-${id}` };
    settleVoucher(); tx.set(paymentRef, payment); tx.update(ref, { confirmedPaymentRequestId: id });
    appendAudit(tx, db, { actorId, action: "daily-cash-confirmed", entityType: "paymentRequest", entityId: id,
      personId: charge.personId, operationId: `confirm-${id}`, before: { status: previous?.status ?? null }, after: { status: "approved", amountMinor: charge.amountMinor, method: "cash" }, reason: "Cash received and reviewed" });
    return { ok: true };
  });
}
