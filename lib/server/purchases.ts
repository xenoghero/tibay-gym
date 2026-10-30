import "server-only";
import { preparePaymentAccount } from "./payment-methods";
import { isPaymentMethod } from "@/lib/finance/payment-methods";
import { createHash } from "node:crypto";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Charge, GymSettings, PaymentRequest } from "@/lib/finance/contracts";
import { snapshotRate, operationId, philippineDate, membershipMonths } from "@/lib/finance/rules";
import { membershipCoverage, snapshotMembership, coverageExpiryMs, type MembershipSnapshot } from "@/lib/finance/coverage";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { prepareTransactionNumber } from "./transaction-numbers";
import { readyReceipt } from "./receipt-proof";
import { appendAudit } from "./audit";
import { prepareReferenceClaim } from "./gcash-references";
import { prepareVoucher, previewVoucher, prepareVoucherSettlement } from "./vouchers";
import type { DiscountQuote } from "@/lib/finance/vouchers";
type Person = Record<string, unknown> & { type: string; status: string | null; membershipExpiry: Timestamp | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const purchaseChargeId = (personId: string, operation: string) => `purchase-${hash([personId, operation])}`;
export const purchaseRequestId = (personId: string, operation: string) => `pay-${hash([personId, operation])}`;
export interface PurchaseQuote {
  baseAmountMinor?: number; discountAmountMinor?: number; voucherSnapshot?: DiscountQuote["voucherSnapshot"];
  kind: Charge["kind"]; amountMinor: number; categorySnapshot: string; rateRevision: number;
  coverage: Charge["requestedCoverage"]; quoteToken: string; previousRequestId: string | null;
}
function quoteFor(person: Person, settings: GymSettings, at: number, previous?: { charge: Charge; requestId: string }, discount?: DiscountQuote, quoteOwner = "new-profile", months = 1): PurchaseQuote {
  let snapshot;
  try { snapshot = previous ? previous.charge : snapshotRate(settings, person.rateCategory, person.type === "member" ? "renewal" : "new_membership", months); }
  catch { throw new ApiError(409, "monthly-price-or-category-unset"); }
  const kind = previous?.charge.kind ?? (person.type === "member" ? "renewal" : "new_membership");
  const coverage = kind === "daily_session" ? null : membershipCoverage(snapshotMembership(person), at, snapshot.quantity);
  const fields = { kind, amountMinor: discount?.amountMinor ?? snapshot.amountMinor, categorySnapshot: snapshot.categorySnapshot,
    ...(previous ? { baseAmountMinor: previous.charge.baseAmountMinor ?? snapshot.amountMinor, discountAmountMinor: previous.charge.discountAmountMinor ?? 0, voucherSnapshot: previous.charge.voucherSnapshot ?? null } : discount ? { baseAmountMinor: discount.baseAmountMinor, discountAmountMinor: discount.discountAmountMinor, voucherSnapshot: discount.voucherSnapshot } : {}),
    rateRevision: snapshot.rateRevision, coverage, previousRequestId: previous?.requestId ?? null };
  return { ...fields, quoteToken: hash([quoteOwner, fields, snapshotMembership(person), philippineDate(at)]) };
}
function purchaseMonths(value: unknown) {
  try { return membershipMonths(value); } catch { throw new ApiError(400, "invalid-membership-months"); }
}
export async function getPurchaseQuote(personId: string, previousRequestId?: string, voucherCode?: string, months?: number) {
  const duration = purchaseMonths(months);
  const db = adminDb(), person = (await db.doc(`persons/${documentId(personId)}`).get()).data() as Person | undefined;
  if (!person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
  const settings = (await db.doc("gymSettings/finance").get()).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt) throw new ApiError(409, "finance-not-enabled");
  let previous: { charge: Charge; requestId: string } | undefined;
  if (previousRequestId) {
    const request = (await db.doc(`paymentRequests/${documentId(previousRequestId)}`).get()).data();
    if (!request || request.personId !== personId || request.status !== "rejected") throw new ApiError(409, "replacement-unavailable");
    const charge = (await db.doc(`charges/${request.chargeId}`).get()).data() as Charge;
    if (!charge || charge.personId !== personId || charge.confirmedPaymentRequestId || charge.abandonedAt || charge.activePaymentRequestId !== previousRequestId) throw new ApiError(409, "replacement-unavailable");
    previous = { charge, requestId: previousRequestId };
  }
  if (previous && voucherCode) throw new ApiError(409, "replacement-voucher-locked");
  if (previous && months !== undefined && months !== previous.charge.quantity) throw new ApiError(409, "replacement-duration-locked");
  const basic = quoteFor(person, settings, Date.now(), previous, undefined, personId, duration);
  const discount = voucherCode ? await previewVoucher({ code: voucherCode, personId, kind: basic.kind,
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: Date.now() }) : undefined;
  return quoteFor(person, settings, Date.now(), previous, discount, personId, duration);
}
export async function newProfileQuote(category: unknown, voucherCode?: string) {
  const settings = (await adminDb().doc("gymSettings/finance").get()).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt) throw new ApiError(409, "finance-not-enabled");
  const person: Person = { type: "guest", status: null, membershipExpiry: null, rateCategory: category };
  const basic = quoteFor(person, settings, Date.now());
  const discount = voucherCode ? await previewVoucher({ code: voucherCode, personId: "new-profile-preview", kind: "new_membership",
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: Date.now() }) : undefined;
  return quoteFor(person, settings, Date.now(), undefined, discount);
}
/** Read-only preparation shared by customer/admin submissions and atomic admin profile creation. */
export async function preparePurchase(tx: Transaction, db: Firestore, actorId: string, personId: string, person: Person, body: Record<string, unknown>, newProfile = false) {
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  if (!isPaymentMethod(body.method)) throw new ApiError(400, "invalid-payment-method");
  const settings = (await tx.get(db.doc("gymSettings/finance"))).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt) throw new ApiError(409, "finance-not-enabled");
  let prior: { charge: Charge; requestId: string } | undefined;
  if (body.previousRequestId) {
    const previousId = documentId(body.previousRequestId), request = (await tx.get(db.doc(`paymentRequests/${previousId}`))).data();
    if (!request || request.personId !== personId || request.status !== "rejected") throw new ApiError(409, "replacement-unavailable");
    const charge = (await tx.get(db.doc(`charges/${request.chargeId}`))).data() as Charge;
    if (!charge || charge.personId !== personId || charge.confirmedPaymentRequestId || charge.abandonedAt || charge.activePaymentRequestId !== previousId) throw new ApiError(409, "replacement-unavailable");
    prior = { charge, requestId: previousId };
  }
  const months = purchaseMonths(body.months);
  if (prior && body.months !== undefined && months !== prior.charge.quantity) throw new ApiError(409, "replacement-duration-locked");
  const now = Date.now(), basic = quoteFor(person, settings, now, prior, undefined, newProfile ? "new-profile" : personId, months);
  if (prior && body.voucherCode) throw new ApiError(409, "replacement-voucher-locked");
  const voucher = !prior && body.voucherCode ? await prepareVoucher(tx, db, { code: body.voucherCode, personId, actorId, kind: basic.kind,
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: now }) : null;
  const quote = quoteFor(person, settings, now, prior, voucher ?? undefined, newProfile ? "new-profile" : personId, months);
  if (body.quoteToken !== quote.quoteToken) throw new ApiError(409, "purchase-quote-changed");
  const stateRef = db.doc(`membershipPurchaseState/${personId}`), state = (await tx.get(stateRef)).data();
  if (quote.kind !== "daily_session" && state?.activeRequestId) {
    const active = (await tx.get(db.doc(`paymentRequests/${state.activeRequestId}`))).data();
    if (active?.status === "pending") throw new ApiError(409, "pending-purchase-exists");
    if (active?.status === "rejected" && active.id !== prior?.requestId) {
      const activeCharge = (await tx.get(db.doc(`charges/${active.chargeId}`))).data();
      if (activeCharge?.voucherSnapshot && !activeCharge.abandonedAt) throw new ApiError(409, "correct-or-close-purchase");
    }
  }
  const chargeId = prior?.charge.id ?? purchaseChargeId(personId, operation);
  const requestId = purchaseRequestId(personId, operation);
  const paymentAccountSnapshot = await preparePaymentAccount(tx, db, body.method, body.paymentRevision);
  const proof = body.method !== "cash" ? await readyReceipt(tx, db, { paymentMethod: body.method, paymentRevision: typeof body.paymentRevision === "number" ? body.paymentRevision : undefined, personId, chargeId, amountMinor: quote.amountMinor, at: now,
    receiptId: typeof body.receiptId === "string" ? body.receiptId : undefined, receiptToken: typeof body.receiptToken === "string" ? body.receiptToken : undefined }) : null;
  if (proof && proof.paymentRequestId !== requestId) throw new ApiError(409, "valid-receipt-required");
  const number = prior ? null : await prepareTransactionNumber(tx, db);
  const price = prior?.charge ?? snapshotRate(settings, person.rateCategory, quote.kind, months);
  const charge: Charge = prior?.charge ?? { id: chargeId, ...price,
    ...(voucher ? { baseAmountMinor: voucher.baseAmountMinor, discountAmountMinor: voucher.discountAmountMinor, amountMinor: voucher.amountMinor, voucherSnapshot: voucher.voucherSnapshot } : {}),
    tibayTransactionNumber: number!.number, personId, kind: quote.kind, chargeDate: philippineDate(now),
    createdAt: now, recognizedPurchaseAt: null, requestedCoverage: quote.coverage, approvedCoverage: null, dailyVisitDate: null, attendanceLogId: null, uniqueDailyKey: null, operationId: operation };
  const payment: PaymentRequest & { membershipSnapshot: MembershipSnapshot } = { id: requestId, chargeId, personId, method: body.method, paymentAccountSnapshot, status: "pending", amountMinor: quote.amountMinor,
    receiptId: proof?.receiptId ?? null, submittedAt: now, previousRequestId: prior?.requestId ?? null, reviewedBy: null, reviewedAt: null, rejectionReason: null,
    confirmedAt: null, appliedCoverage: null, gcashReferenceSnapshot: null, operationId: operation, membershipSnapshot: snapshotMembership(person) };
  return { result: { id: requestId, chargeId }, commit: () => {
    number?.commit(); proof?.commit(); voucher?.commit(chargeId, charge.tibayTransactionNumber);
    tx.set(db.doc(`charges/${chargeId}`), { ...charge, activePaymentRequestId: requestId });
    tx.set(db.doc(`paymentRequests/${requestId}`), payment);
    if (quote.kind !== "daily_session") tx.set(stateRef, { activeRequestId: requestId });
    appendAudit(tx, db, { actorId, action: prior ? "payment-replacement-submitted" : "membership-purchase-submitted", entityType: "paymentRequest", entityId: requestId,
      personId, operationId: operation, after: { kind: quote.kind, method: payment.method, amountMinor: quote.amountMinor, status: "pending" } });
  } };
}
export async function submitPurchase(actorId: string, personId: string, body: Record<string, unknown>) {
  documentId(personId);
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const db = adminDb(), operationRef = db.doc(`purchaseOperations/${operation}`), digest = hash([actorId, personId, body]);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(operationRef)).data();
    if (prior) { if (prior.digest !== digest) throw new ApiError(409, "operation-conflict"); return prior.result; }
    const person = (await tx.get(db.doc(`persons/${personId}`))).data() as Person | undefined;
    if (!person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
    const staged = await preparePurchase(tx, db, actorId, personId, person, body);
    staged.commit(); tx.set(operationRef, { digest, result: staged.result }); return staged.result;
  });
}
function approvalPreview(payment: PaymentRequest, charge: Charge, person: Person, review: Record<string, unknown> | undefined, at: number) {
  const coverage = payment.status === "approved" ? payment.appliedCoverage : charge.kind === "daily_session" ? null : membershipCoverage(snapshotMembership(person), at, charge.quantity);
  return { coverage, previewToken: hash([payment.id, charge.amountMinor, payment.method, snapshotMembership(person), coverage, review?.reviewRevision ?? 0, philippineDate(at)]) };
}
export async function paymentReviewPreview(id: string) {
  const db = adminDb(), payment = (await db.doc(`paymentRequests/${documentId(id)}`).get()).data() as (PaymentRequest & { membershipSnapshot?: MembershipSnapshot }) | undefined;
  if (!payment) throw new ApiError(404, "payment-unavailable");
  const charge = (await db.doc(`charges/${payment.chargeId}`).get()).data() as Charge;
  const person = ((await db.doc(`persons/${payment.personId}`).get()).data() ?? (await db.doc(`unverifiedPersons/${payment.personId}`).get()).data()) as Person | undefined;
  if (!charge || !person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
  const review = payment.receiptId ? (await db.doc(`receiptReviews/${payment.receiptId}`).get()).data() : undefined;
  return { ...approvalPreview(payment, charge, person, review, Date.now()), membershipChanged: payment.status === "pending" && charge.kind !== "daily_session" && hash(payment.membershipSnapshot) !== hash(snapshotMembership(person)),
    payment, charge, customer: { id: payment.personId, name: person.name, rateCategory: person.rateCategory }, receiptReview: review ?? null };
}
export async function decidePayment(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.paymentRequestId);
  if (body.decision !== "approve" && body.decision !== "reject") throw new ApiError(400, "invalid-decision");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.decision === "reject" && (!reason || reason.length > 500)) throw new ApiError(400, "rejection-reason-required");
  if (body.reviewed !== true) throw new ApiError(400, "payment-review-required");
  const db = adminDb();
  return db.runTransaction(async tx => {
    const paymentRef = db.doc(`paymentRequests/${id}`), payment = (await tx.get(paymentRef)).data() as (PaymentRequest & { membershipSnapshot?: MembershipSnapshot }) | undefined;
    if (!payment) throw new ApiError(404, "payment-unavailable");
    if (payment.status === (body.decision === "approve" ? "approved" : "rejected")) return { ok: true, status: payment.status };
    if (payment.status !== "pending") throw new ApiError(409, "payment-not-pending");
    const chargeRef = db.doc(`charges/${payment.chargeId}`), charge = (await tx.get(chargeRef)).data() as Charge | undefined;
    if (!charge || charge.confirmedPaymentRequestId || charge.abandonedAt || charge.activePaymentRequestId !== id) throw new ApiError(409, "charge-review-changed");
    if (payment.amountMinor !== charge.amountMinor) throw new ApiError(409, "payment-amount-conflict");
    const personRef = db.doc(`persons/${payment.personId}`), person = (await tx.get(personRef)).data() as Person | undefined;
    const pending = !person ? (await tx.get(db.doc(`unverifiedPersons/${payment.personId}`))).data() as Person | undefined : undefined;
    if (!(person ?? pending) || (person ?? pending)!.deletingAt || (charge.kind !== "daily_session" && !person)) throw new ApiError(409, "verified-profile-required");
    const receiptReview = payment.receiptId ? (await tx.get(db.doc(`receiptReviews/${payment.receiptId}`))).data() : undefined;
    const now = Date.now(), preview = approvalPreview(payment, charge, (person ?? pending)!, receiptReview, now);
    if (body.previewToken !== preview.previewToken) throw new ApiError(409, "payment-review-changed");
    const changed = charge.kind !== "daily_session" && hash(payment.membershipSnapshot) !== hash(snapshotMembership(person!));
    if (body.decision === "approve" && changed && body.acknowledgeMembershipChange !== true) throw new ApiError(409, "membership-review-required");
    let reference: Awaited<ReturnType<typeof prepareReferenceClaim>> | null = null;
    if (body.decision === "approve" && payment.method !== "cash") {
      if (!payment.receiptId || !receiptReview?.confirmedReference || receiptReview.confirmedAmountMinor !== payment.amountMinor || payment.amountMinor !== charge.amountMinor) throw new ApiError(409, "receipt-review-required");
      reference = await prepareReferenceClaim(tx, db, receiptReview.confirmedReference, id, charge.id, payment.paymentAccountSnapshot);
    }
    const approved = body.decision === "approve";
    const settleVoucher = approved ? await prepareVoucherSettlement(tx, db, charge, "confirmed", actorId, now) : null;
    tx.update(paymentRef, { status: approved ? "approved" : "rejected", reviewedBy: actorId, reviewedAt: now, rejectionReason: approved ? null : reason,
      confirmedAt: approved ? now : null, appliedCoverage: approved ? preview.coverage : null, gcashReferenceSnapshot: reference?.normalizedReference ?? null });
    if (approved) {
      settleVoucher?.();
      reference?.commit();
      tx.update(chargeRef, { confirmedPaymentRequestId: id, recognizedPurchaseAt: charge.kind === "daily_session" ? null : now, approvedCoverage: preview.coverage });
      if (preview.coverage) {
        tx.update(personRef, { type: "member", status: "active", membershipExpiry: Timestamp.fromMillis(coverageExpiryMs(preview.coverage)),
          joinDate: person!.joinDate ?? Timestamp.fromMillis(Date.parse(`${preview.coverage.startDate}T00:00:00+08:00`)), updatedAt: Timestamp.fromMillis(now) });
        tx.set(db.doc(`statusChanges/${id}`), { personId: payment.personId, fromStatus: person!.status, toStatus: "active", reason: "Approved membership purchase", changedAt: Timestamp.fromMillis(now),
          previousExpiry: person!.membershipExpiry ?? null, newExpiry: Timestamp.fromMillis(coverageExpiryMs(preview.coverage)) });
      }
    }
    appendAudit(tx, db, { actorId, action: approved ? "payment-approved" : "payment-rejected", entityType: "paymentRequest", entityId: id, personId: payment.personId,
      operationId: `${body.decision}-${id}`, before: { status: "pending" }, after: { status: approved ? "approved" : "rejected", kind: charge.kind, amountMinor: payment.amountMinor, method: payment.method,
        ...(preview.coverage && approved ? { membershipExpiry: coverageExpiryMs(preview.coverage) } : {}), normalizedReference: reference?.normalizedReference ?? null }, reason: approved ? "Payment received and reviewed" : reason });
    return { ok: true, status: approved ? "approved" : "rejected" };
  });
}

/** Final close is separate from a rejection: it prevents correction at the held price. */
export async function abandonPurchase(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.chargeId), reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500 || body.confirmed !== true) throw new ApiError(400, "abandonment-reason-required");
  const db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`charges/${id}`), charge = (await tx.get(ref)).data() as Charge | undefined;
    if (!charge || charge.kind === "daily_session" || charge.confirmedPaymentRequestId) throw new ApiError(409, "purchase-cannot-close");
    if (charge.abandonedAt) return { ok: true };
    if (body.paymentRequestId !== charge.activePaymentRequestId) throw new ApiError(409, "charge-review-changed");
    const paymentRef = charge.activePaymentRequestId ? db.doc(`paymentRequests/${charge.activePaymentRequestId}`) : null;
    const payment = paymentRef ? (await tx.get(paymentRef)).data() : null;
    const stateRef = db.doc(`membershipPurchaseState/${charge.personId}`), state = (await tx.get(stateRef)).data();
    if (payment?.status === "approved") throw new ApiError(409, "purchase-cannot-close");
    const now = Date.now(), release = await prepareVoucherSettlement(tx, db, charge, "released", actorId, now);
    release(); tx.update(ref, { abandonedAt: now, abandonmentReason: reason });
    if (paymentRef && payment?.status === "pending") tx.update(paymentRef, { status: "rejected", reviewedAt: now, reviewedBy: actorId, rejectionReason: `Closed: ${reason}` });
    if (state?.activeRequestId === charge.activePaymentRequestId) tx.set(stateRef, { activeRequestId: null });
    appendAudit(tx, db, { actorId, action: "membership-purchase-abandoned", entityType: "charge", entityId: id, personId: charge.personId,
      operationId: `abandon-${id}`, before: { status: payment?.status ?? null }, after: { status: "abandoned" }, reason });
    return { ok: true };
  });
}
