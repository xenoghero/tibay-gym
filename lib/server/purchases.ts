import "server-only";
import { preparePaymentAccount } from "./payment-methods";
import { isPaymentMethod } from "@/lib/finance/payment-methods";
import { createHash } from "node:crypto";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Charge, ChargeKind, Coverage, GymSettings, PaymentRequest, RateSnapshot } from "@/lib/finance/contracts";
import { snapshotRate, operationId, philippineDate, membershipMonths, rateCategory } from "@/lib/finance/rules";
import { MAX_TOP_UP_SESSIONS, type ClientPackage, type CoachingSettings } from "@/lib/coaching/catalog";
import { addManilaDays, currentPackage } from "@/lib/coaching/clocks";
import { assertNoActivePackage, coachingSettings, getCoachingSettings } from "./coaching";
import { membershipCoverage, snapshotMembership, coverageExpiryMs, type MembershipSnapshot } from "@/lib/finance/coverage";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { prepareTransactionNumber } from "./transaction-numbers";
import { readyReceipt } from "./receipt-proof";
import { appendAudit } from "./audit";
import { prepareReferenceClaim } from "./gcash-references";
import { prepareVoucher, previewVoucher, prepareVoucherSettlement } from "./vouchers";
import { approveUnverified } from "./unverified";
import type { DiscountQuote } from "@/lib/finance/vouchers";
type Person = Record<string, unknown> & { type: string; status: string | null; membershipExpiry: Timestamp | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const purchaseChargeId = (personId: string, operation: string) => `purchase-${hash([personId, operation])}`;
export const purchaseRequestId = (personId: string, operation: string) => `pay-${hash([personId, operation])}`;
export interface PurchaseQuote {
  baseAmountMinor?: number; discountAmountMinor?: number; voucherSnapshot?: DiscountQuote["voucherSnapshot"];
  kind: Charge["kind"]; amountMinor: number; categorySnapshot: string; rateRevision: number;
  coverage: Charge["requestedCoverage"]; quoteToken: string; previousRequestId: string | null; coachingPackage?: Charge["coachingPackage"];
  /** Session top-ups only: how many and the per-session price. */
  quantity?: number; unitRateMinor?: number;
}
/** What a purchase buys, its price, and the membership coverage approving it applies (null: none). New products plug in here. */
export interface PurchaseProduct { kind: ChargeKind; price: RateSnapshot; coverage(membership: MembershipSnapshot, at: number): Coverage | null; coachingPackage?: Charge["coachingPackage"] }
const isMembership = (kind: ChargeKind) => kind === "renewal" || kind === "new_membership";
const coverageFor = (kind: ChargeKind, months: number) => (membership: MembershipSnapshot, at: number) =>
  isMembership(kind) ? membershipCoverage(membership, at, months) : null;
/** A visible catalog package at its one price; its membership month is applied at Package start, not approval. */
export function coachingProduct(catalog: CoachingSettings, person: Record<string, unknown>, packageId: unknown): PurchaseProduct {
  const item = catalog.packages.find(entry => entry.id === packageId && entry.visible);
  if (!item) throw new ApiError(409, "coaching-package-unavailable");
  const category = rateCategory(person.rateCategory);
  if (!category) throw new ApiError(409, "category-required");
  return { kind: "coaching_package", coverage: () => null, coachingPackage: { packageId: item.id, sessions: item.sessions, validityDays: item.validityDays },
    price: { categorySnapshot: category, rateRevision: catalog.revision, unitRateMinor: item.priceMinor, quantity: 1, amountMinor: item.priceMinor } };
}
function membershipProduct(settings: GymSettings, person: Person, months: number): PurchaseProduct {
  const kind = person.type === "member" ? "renewal" : "new_membership";
  try { return { kind, price: snapshotRate(settings, person.rateCategory, kind, months), coverage: coverageFor(kind, months) }; }
  catch { throw new ApiError(409, "monthly-price-or-category-unset"); }
}
/** Session top-ups: any quantity at one per-session price; coaching only, never gym access. */
export function topUpProduct(catalog: CoachingSettings, person: Record<string, unknown>, quantity: unknown): PurchaseProduct {
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TOP_UP_SESSIONS) throw new ApiError(400, "invalid-top-up-sessions");
  const category = rateCategory(person.rateCategory);
  if (!category) throw new ApiError(409, "category-required");
  return { kind: "session_topup", coverage: () => null,
    price: { categorySnapshot: category, rateRevision: catalog.revision, unitRateMinor: catalog.topUpPriceMinor, quantity, amountMinor: catalog.topUpPriceMinor * quantity } };
}
const isCoaching = (kind: ChargeKind) => kind === "coaching_package" || kind === "session_topup";
/** The product a saved charge bought, for replacements and approval. */
const chargeProduct = (charge: Charge): PurchaseProduct => ({ kind: charge.kind, price: charge, coverage: coverageFor(charge.kind, charge.quantity),
  ...(charge.coachingPackage ? { coachingPackage: charge.coachingPackage } : {}) });
function quoteFor(person: Person, product: PurchaseProduct, at: number, previous?: { charge: Charge; requestId: string }, discount?: DiscountQuote, quoteOwner = "new-profile"): PurchaseQuote {
  const { kind, price: snapshot } = product, coverage = product.coverage(snapshotMembership(person), at);
  const fields = { kind, amountMinor: discount?.amountMinor ?? snapshot.amountMinor, categorySnapshot: snapshot.categorySnapshot,
    ...(previous ? { baseAmountMinor: previous.charge.baseAmountMinor ?? snapshot.amountMinor, discountAmountMinor: previous.charge.discountAmountMinor ?? 0, voucherSnapshot: previous.charge.voucherSnapshot ?? null } : discount ? { baseAmountMinor: discount.baseAmountMinor, discountAmountMinor: discount.discountAmountMinor, voucherSnapshot: discount.voucherSnapshot } : {}),
    rateRevision: snapshot.rateRevision, coverage, previousRequestId: previous?.requestId ?? null, ...(product.coachingPackage ? { coachingPackage: product.coachingPackage } : {}),
    ...(kind === "session_topup" ? { quantity: snapshot.quantity, unitRateMinor: snapshot.unitRateMinor } : {}) };
  return { ...fields, quoteToken: hash([quoteOwner, fields, snapshotMembership(person), philippineDate(at)]) };
}
function purchaseMonths(value: unknown) {
  try { return membershipMonths(value); } catch { throw new ApiError(400, "invalid-membership-months"); }
}
export async function getPurchaseQuote(personId: string, previousRequestId?: string, voucherCode?: string, months?: number, packageId?: string, topUpSessions?: number) {
  const duration = purchaseMonths(months);
  const db = adminDb(), official = (await db.doc(`persons/${documentId(personId)}`).get()).data() as Person | undefined;
  // Unverified profiles (from the Coaching sign-up link) may buy coaching only.
  const person = official ?? (await db.doc(`unverifiedPersons/${personId}`).get()).data() as Person | undefined;
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
  const product = previous ? chargeProduct(previous.charge) : packageId !== undefined ? coachingProduct(await getCoachingSettings(), person, packageId)
    : topUpSessions !== undefined ? topUpProduct(await getCoachingSettings(), person, topUpSessions) : membershipProduct(settings, person, duration);
  if (!official && !isCoaching(product.kind)) throw new ApiError(409, "verified-profile-required");
  if (product.kind === "coaching_package") await assertNoActivePackage(personId, previous?.charge.id);
  const basic = quoteFor(person, product, Date.now(), previous, undefined, personId);
  const discount = voucherCode ? await previewVoucher({ code: voucherCode, personId, kind: basic.kind,
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: Date.now() }) : undefined;
  return quoteFor(person, product, Date.now(), previous, discount, personId);
}
export async function newProfileQuote(category: unknown, voucherCode?: string) {
  const settings = (await adminDb().doc("gymSettings/finance").get()).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt) throw new ApiError(409, "finance-not-enabled");
  const person: Person = { type: "guest", status: null, membershipExpiry: null, rateCategory: category };
  const product = membershipProduct(settings, person, 1), basic = quoteFor(person, product, Date.now());
  const discount = voucherCode ? await previewVoucher({ code: voucherCode, personId: "new-profile-preview", kind: basic.kind,
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: Date.now() }) : undefined;
  return quoteFor(person, product, Date.now(), undefined, discount);
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
  const catalog = !prior && (body.packageId !== undefined || body.topUpSessions !== undefined) ? coachingSettings((await tx.get(db.doc("gymSettings/coaching"))).data()) : null;
  const product = prior ? chargeProduct(prior.charge) : body.packageId !== undefined ? coachingProduct(catalog!, person, body.packageId)
    : body.topUpSessions !== undefined ? topUpProduct(catalog!, person, body.topUpSessions) : membershipProduct(settings, person, months);
  const coaching = product.kind === "coaching_package", packageRef = db.doc(`coachingPackages/${prior?.charge.id ?? purchaseChargeId(personId, operation)}`);
  // A per-client lock document serializes concurrent package submissions for the one-active-package rule.
  const coachingLock = db.doc(`coachingPurchaseState/${personId}`);
  if (coaching) {
    await tx.get(coachingLock);
    await assertNoActivePackage(personId, prior?.charge.id, tx, db);
    if (prior && !(await tx.get(packageRef)).data()) throw new ApiError(409, "replacement-unavailable");
  }
  const now = Date.now(), basic = quoteFor(person, product, now, prior, undefined, newProfile ? "new-profile" : personId);
  if (prior && body.voucherCode) throw new ApiError(409, "replacement-voucher-locked");
  const voucher = !prior && body.voucherCode ? await prepareVoucher(tx, db, { code: body.voucherCode, personId, actorId, kind: basic.kind,
    category: basic.categorySnapshot as "student" | "regular", baseAmountMinor: basic.amountMinor, at: now }) : null;
  const quote = quoteFor(person, product, now, prior, voucher ?? undefined, newProfile ? "new-profile" : personId);
  if (body.quoteToken !== quote.quoteToken) throw new ApiError(409, "purchase-quote-changed");
  const stateRef = db.doc(`membershipPurchaseState/${personId}`), state = (await tx.get(stateRef)).data();
  if (isMembership(quote.kind) && state?.activeRequestId) {
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
  const charge: Charge = prior?.charge ?? { id: chargeId, ...product.price, ...(product.coachingPackage ? { coachingPackage: product.coachingPackage } : {}),
    ...(voucher ? { baseAmountMinor: voucher.baseAmountMinor, discountAmountMinor: voucher.discountAmountMinor, amountMinor: voucher.amountMinor, voucherSnapshot: voucher.voucherSnapshot } : {}),
    tibayTransactionNumber: number!.number, personId, kind: quote.kind, chargeDate: philippineDate(now),
    createdAt: now, recognizedPurchaseAt: null, requestedCoverage: quote.coverage, approvedCoverage: null, dailyVisitDate: null, attendanceLogId: null, uniqueDailyKey: null, operationId: operation };
  const payment: PaymentRequest & { membershipSnapshot: MembershipSnapshot } = { id: requestId, chargeId, personId, method: body.method, paymentAccountSnapshot, status: "pending", amountMinor: quote.amountMinor,
    receiptId: proof?.receiptId ?? null, submittedAt: now, previousRequestId: prior?.requestId ?? null, reviewedBy: null, reviewedAt: null, rejectionReason: null,
    confirmedAt: null, appliedCoverage: null, gcashReferenceSnapshot: null, operationId: operation, membershipSnapshot: snapshotMembership(person) };
  return { result: { id: requestId, chargeId }, kind: product.kind, commit: () => {
    number?.commit(); proof?.commit(); voucher?.commit(chargeId, charge.tibayTransactionNumber);
    tx.set(db.doc(`charges/${chargeId}`), { ...charge, activePaymentRequestId: requestId });
    tx.set(db.doc(`paymentRequests/${requestId}`), payment);
    if (isMembership(quote.kind)) tx.set(stateRef, { activeRequestId: requestId });
    if (coaching) tx.set(coachingLock, { lastRequestId: requestId, updatedAt: now });
    if (coaching && prior) tx.update(packageRef, { paymentRequestId: requestId, status: "pending" });
    else if (coaching) tx.set(packageRef, { id: chargeId, personId, chargeId, paymentRequestId: requestId, packageId: product.coachingPackage!.packageId,
      priceMinor: product.price.unitRateMinor, sessions: product.coachingPackage!.sessions, validityDays: product.coachingPackage!.validityDays, status: "pending",
      submittedAt: now, approvedAt: null, startedAt: null, coachingExpiresAt: null, sessionsUsed: 0, topUpSessions: 0 } satisfies ClientPackage);
    appendAudit(tx, db, { actorId, action: prior ? "payment-replacement-submitted" : coaching ? "coaching-purchase-submitted" : "membership-purchase-submitted", entityType: "paymentRequest", entityId: requestId,
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
    const official = (await tx.get(db.doc(`persons/${personId}`))).data() as Person | undefined;
    const person = official ?? (await tx.get(db.doc(`unverifiedPersons/${personId}`))).data() as Person | undefined;
    if (!person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
    const staged = await preparePurchase(tx, db, actorId, personId, person, body);
    if (!official && !isCoaching(staged.kind)) throw new ApiError(409, "verified-profile-required");
    staged.commit(); tx.set(operationRef, { digest, result: staged.result }); return staged.result;
  });
}
function approvalPreview(payment: PaymentRequest, charge: Charge, person: Person, review: Record<string, unknown> | undefined, at: number) {
  const coverage = payment.status === "approved" ? payment.appliedCoverage : chargeProduct(charge).coverage(snapshotMembership(person), at);
  return { coverage, previewToken: hash([payment.id, charge.amountMinor, payment.method, snapshotMembership(person), coverage, review?.reviewRevision ?? 0, philippineDate(at)]) };
}
export async function paymentReviewPreview(id: string) {
  const db = adminDb(), payment = (await db.doc(`paymentRequests/${documentId(id)}`).get()).data() as (PaymentRequest & { membershipSnapshot?: MembershipSnapshot }) | undefined;
  if (!payment) throw new ApiError(404, "payment-unavailable");
  const charge = (await db.doc(`charges/${payment.chargeId}`).get()).data() as Charge;
  const person = ((await db.doc(`persons/${payment.personId}`).get()).data() ?? (await db.doc(`unverifiedPersons/${payment.personId}`).get()).data()) as Person | undefined;
  if (!charge || !person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
  const review = payment.receiptId ? (await db.doc(`receiptReviews/${payment.receiptId}`).get()).data() : undefined;
  const preview = approvalPreview(payment, charge, person, review, Date.now());
  return { ...preview, membershipChanged: payment.status === "pending" && preview.coverage !== null && hash(payment.membershipSnapshot) !== hash(snapshotMembership(person)),
    payment, charge, customer: { id: payment.personId, name: person.name, rateCategory: person.rateCategory }, receiptReview: review ?? null };
}
export async function decidePayment(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.paymentRequestId);
  if (body.decision !== "approve" && body.decision !== "reject") throw new ApiError(400, "invalid-decision");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.decision === "reject" && (!reason || reason.length > 500)) throw new ApiError(400, "rejection-reason-required");
  if (body.reviewed !== true) throw new ApiError(400, "payment-review-required");
  const db = adminDb();
  const decided = await db.runTransaction(async tx => {
    const paymentRef = db.doc(`paymentRequests/${id}`), payment = (await tx.get(paymentRef)).data() as (PaymentRequest & { membershipSnapshot?: MembershipSnapshot }) | undefined;
    if (!payment) throw new ApiError(404, "payment-unavailable");
    if (payment.status === (body.decision === "approve" ? "approved" : "rejected")) return { ok: true, status: payment.status };
    if (payment.status !== "pending") throw new ApiError(409, "payment-not-pending");
    const chargeRef = db.doc(`charges/${payment.chargeId}`), charge = (await tx.get(chargeRef)).data() as Charge | undefined;
    if (!charge || charge.confirmedPaymentRequestId || charge.abandonedAt || charge.activePaymentRequestId !== id) throw new ApiError(409, "charge-review-changed");
    if (payment.amountMinor !== charge.amountMinor) throw new ApiError(409, "payment-amount-conflict");
    const packageRef = charge.kind === "coaching_package" ? db.doc(`coachingPackages/${charge.id}`) : null;
    if (packageRef && !(await tx.get(packageRef)).data()) throw new ApiError(409, "charge-review-changed");
    const topUp = charge.kind === "session_topup" && body.decision === "approve" ? await prepareTopUpHolding(tx, db, charge) : null;
    const personRef = db.doc(`persons/${payment.personId}`), person = (await tx.get(personRef)).data() as Person | undefined;
    const pending = !person ? (await tx.get(db.doc(`unverifiedPersons/${payment.personId}`))).data() as Person | undefined : undefined;
    const customer = person ?? pending;
    if (!customer || customer.deletingAt) throw new ApiError(409, "verified-profile-required");
    const receiptReview = payment.receiptId ? (await tx.get(db.doc(`receiptReviews/${payment.receiptId}`))).data() : undefined;
    const now = Date.now(), preview = approvalPreview(payment, charge, customer, receiptReview, now);
    // Only a product that grants membership coverage writes to the verified profile.
    if (preview.coverage && !person) throw new ApiError(409, "verified-profile-required");
    if (body.previewToken !== preview.previewToken) throw new ApiError(409, "payment-review-changed");
    const changed = preview.coverage !== null && hash(payment.membershipSnapshot) !== hash(snapshotMembership(person!));
    if (body.decision === "approve" && changed && body.acknowledgeMembershipChange !== true) throw new ApiError(409, "membership-review-required");
    let reference: Awaited<ReturnType<typeof prepareReferenceClaim>> | null = null;
    if (body.decision === "approve" && payment.method !== "cash") {
      if (!payment.receiptId) throw new ApiError(409, "receipt-review-required");
      // The admin confirms the receipt's reference in the approval itself; older saved reviews still count.
      const typed = typeof body.reference === "string" && body.reference.trim() ? body.reference : receiptReview?.confirmedReference;
      if (!typed) throw new ApiError(409, "receipt-review-required");
      reference = await prepareReferenceClaim(tx, db, typed, id, charge.id, payment.paymentAccountSnapshot, body.allowDuplicateReference === true);
    }
    const approved = body.decision === "approve";
    const settleVoucher = approved ? await prepareVoucherSettlement(tx, db, charge, "confirmed", actorId, now) : null;
    if (packageRef) tx.update(packageRef, approved ? { status: "approved", approvedAt: now } : { status: "rejected" });
    if (approved) topUp?.(now);
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
  // Retrying an approval re-runs this, so a failed verification is never left behind.
  if (decided.status === "approved") await verifyCoachingBuyer(actorId, id);
  return decided;
}

/**
 * Reads, then returns the write that places approved top-ups: on the client's current package (sharing its coaching
 * expiry, Freeze extensions included), or else as a standalone holding that expires after the top-up validity.
 */
async function prepareTopUpHolding(tx: Transaction, db: Firestore, charge: Charge) {
  const records = (await tx.get(db.collection("coachingPackages").where("personId", "==", charge.personId))).docs.map(row => row.data() as ClientPackage);
  const catalog = coachingSettings((await tx.get(db.doc("gymSettings/coaching"))).data());
  return (now: number) => {
    // Only an active (started, unexpired) package takes top-ups; otherwise they stand alone.
    const current = currentPackage(records.filter(row => !row.topUp), now);
    if (current?.status === "active") {
      tx.update(db.doc(`coachingPackages/${current.record.id}`), { topUpSessions: current.record.topUpSessions + charge.quantity });
      return;
    }
    tx.set(db.doc(`coachingPackages/${charge.id}`), { id: charge.id, personId: charge.personId, chargeId: charge.id, paymentRequestId: charge.confirmedPaymentRequestId ?? charge.activePaymentRequestId ?? "",
      packageId: "top-up", priceMinor: charge.unitRateMinor, sessions: charge.quantity, validityDays: catalog.topUpValidityDays, status: "active", topUp: true,
      submittedAt: charge.createdAt, approvedAt: now, startedAt: now, sessionsUsed: 0, topUpSessions: 0,
      coachingExpiresAt: Date.parse(`${addManilaDays(philippineDate(now), catalog.topUpValidityDays)}T00:00:00+08:00`) } satisfies ClientPackage);
  };
}

/** Approving the first coaching payment of an unverified profile also verifies it, using the existing approval. */
async function verifyCoachingBuyer(actorId: string, paymentRequestId: string) {
  const db = adminDb(), payment = (await db.doc(`paymentRequests/${paymentRequestId}`).get()).data() as PaymentRequest | undefined;
  if (!payment || payment.status !== "approved") return;
  const charge = (await db.doc(`charges/${payment.chargeId}`).get()).data() as Charge | undefined;
  if (!charge || !isCoaching(charge.kind) || (await db.doc(`persons/${payment.personId}`).get()).exists) return;
  if ((await db.doc(`unverifiedPersons/${payment.personId}`).get()).exists) await approveUnverified(payment.personId, actorId);
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
    const packageRef = charge.kind === "coaching_package" ? db.doc(`coachingPackages/${charge.id}`) : null;
    if (packageRef && !(await tx.get(packageRef)).data()) throw new ApiError(409, "purchase-cannot-close");
    if (payment?.status === "approved") throw new ApiError(409, "purchase-cannot-close");
    const now = Date.now(), release = await prepareVoucherSettlement(tx, db, charge, "released", actorId, now);
    release(); tx.update(ref, { abandonedAt: now, abandonmentReason: reason });
    if (packageRef) tx.update(packageRef, { status: "closed" });
    if (paymentRef && payment?.status === "pending") tx.update(paymentRef, { status: "rejected", reviewedAt: now, reviewedBy: actorId, rejectionReason: `Closed: ${reason}` });
    if (state?.activeRequestId === charge.activePaymentRequestId) tx.set(stateRef, { activeRequestId: null });
    appendAudit(tx, db, { actorId, action: "membership-purchase-abandoned", entityType: "charge", entityId: id, personId: charge.personId,
      operationId: `abandon-${id}`, before: { status: payment?.status ?? null }, after: { status: "abandoned" }, reason });
    return { ok: true };
  });
}
