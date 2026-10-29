import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { getPurchaseQuote, submitPurchase, paymentReviewPreview, decidePayment, purchaseChargeId, purchaseRequestId } from "./purchases";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
import type { PaymentAccount } from "@/lib/finance/payment-methods";
const NOW = Date.parse("2026-10-25T03:00:00Z");
const bank: PaymentAccount = { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678", enabled: true, qrImage: null };
let sequence = 0;
const rows = (name: string) => [...state.store!.data].filter(([path]) => path.startsWith(`${name}/`));
beforeEach(() => {
  state.store = memoryFirestore(); sequence = 0; vi.useFakeTimers(); vi.setSystemTime(NOW);
  state.store.data.set("persons/p1", { name: "Sample", phone: "09123456789", type: "member", status: "active", rateCategory: "student", membershipExpiry: Timestamp.fromMillis(Date.parse("2026-10-31T16:00:00Z")), visitCount: 42, rfidTagId: "CARD", joinDate: Timestamp.fromMillis(NOW - 86400000) });
  state.store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: NOW - 1000, studentMonthlyMinor: 100000, regularMonthlyMinor: 120000 });
});
afterEach(() => vi.useRealTimers());
it("binds a bank receipt to its account and requires reviewed evidence before renewal approval", async () => {
  state.store!.data.set("gymSettings/payments", { revision: 1, accounts: [bank] });
  const operation = "bank-renewal-operation-1", quote = await getPurchaseQuote("p1");
  const receiptId = "a".repeat(64), receiptToken = "b".repeat(43), id = purchaseRequestId("p1", operation);
  state.store!.data.set(`receiptIntents/${receiptId}`, { state: "ready", personId: "p1", chargeId: purchaseChargeId("p1", operation), amountMinor: quote.amountMinor,
    paymentRequestId: id, paymentRevision: 1, paymentMethod: bank.id, tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 10000, linked: false });
  const body = { operationId: operation, quoteToken: quote.quoteToken, method: bank.id, paymentRevision: 1, receiptId, receiptToken };
  await expect(submitPurchase("customer:p1", "p1", { ...body, paymentRevision: 0 })).rejects.toMatchObject({ code: "payment-method-unavailable" });
  await submitPurchase("customer:p1", "p1", body);
  expect(state.store!.data.get(`paymentRequests/${id}`)).toMatchObject({ status: "pending", method: bank.id, paymentAccountSnapshot: { name: bank.name, accountNumber: bank.accountNumber } });
  await expect(decision(id)).rejects.toMatchObject({ code: "receipt-review-required" });
  state.store!.data.set(`receiptReviews/${receiptId}`, { confirmedReference: "BPI-00AB1234", confirmedAmountMinor: quote.amountMinor, reviewRevision: 1 });
  state.store!.data.set("gymSettings/payments", { revision: 2, accounts: [{ ...bank, enabled: false, name: "Old bank" }] });
  await decision(id);
  expect(state.store!.data.get(`paymentRequests/${id}`)).toMatchObject({ status: "approved", gcashReferenceSnapshot: "BPI00AB1234", paymentAccountSnapshot: { name: "BPI savings" } });
  expect(rows("approvedPaymentReferences")).toHaveLength(1);
});
async function request(method: "cash" | "gcash" = "cash", extra = {}) {
  const quote = await getPurchaseQuote("p1"), body = { operationId: `membership-operation-${++sequence}`, quoteToken: quote.quoteToken, method, ...extra };
  return { result: await submitPurchase("customer:p1", "p1", body), body };
}
async function decision(id: string, kind = "approve", extra = {}) {
  const preview = await paymentReviewPreview(id);
  return decidePayment("admin", { paymentRequestId: id, decision: kind, previewToken: preview.previewToken, reviewed: true, ...extra });
}
it("leaves cash membership unchanged until approval, then applies one month exactly once", async () => {
  const original = state.store!.data.get("persons/p1")!.membershipExpiry;
  const { result, body } = await request();
  expect(state.store!.data.get("persons/p1")!.membershipExpiry).toEqual(original);
  expect(await submitPurchase("customer:p1", "p1", body)).toEqual(result); expect(rows("charges")).toHaveLength(1);
  await Promise.all([decision(result.id), decision(result.id)]);
  expect(state.store!.data.get("persons/p1")).toMatchObject({ visitCount: 42, rfidTagId: "CARD", status: "active" });
  expect((state.store!.data.get("persons/p1")!.membershipExpiry as Timestamp).toMillis()).toBe(Date.parse("2026-11-30T16:00:00Z"));
  expect(rows("paymentRequests")[0][1]).toMatchObject({ status: "approved", confirmedAt: NOW, appliedCoverage: { startDate: "2026-11-01", expiryDate: "2026-12-01", months: 1 } });
  expect(rows("statusChanges")).toHaveLength(1);
});
it("restarts expired membership on the approval date, not the old submission date", async () => {
  state.store!.data.get("persons/p1")!.membershipExpiry = Timestamp.fromMillis(NOW - 86400000);
  state.store!.data.get("persons/p1")!.status = "expired";
  const { result } = await request(); vi.setSystemTime(NOW + 3 * 86400000);
  await decision(result.id);
  expect(rows("paymentRequests")[0][1].appliedCoverage).toEqual({ startDate: "2026-10-28", expiryDate: "2026-11-28", months: 1 });
});
it("requires refreshed review and explicit acknowledgment after concurrent membership changes", async () => {
  const { result } = await request(), old = await paymentReviewPreview(result.id);
  state.store!.data.get("persons/p1")!.membershipExpiry = Timestamp.fromMillis(Date.parse("2026-12-31T16:00:00Z"));
  await expect(decidePayment("admin", { paymentRequestId: result.id, decision: "approve", reviewed: true, previewToken: old.previewToken })).rejects.toMatchObject({ code: "payment-review-changed" });
  await expect(decision(result.id)).rejects.toMatchObject({ code: "membership-review-required" });
  await decision(result.id, "approve", { acknowledgeMembershipChange: true });
  expect(rows("paymentRequests")[0][1].appliedCoverage).toMatchObject({ startDate: "2027-01-01", expiryDate: "2027-02-01" });
});
it("rejects with a reason, preserves history, and links a replacement without another charge", async () => {
  const { result } = await request();
  await expect(decision(result.id, "reject")).rejects.toMatchObject({ code: "rejection-reason-required" });
  await decision(result.id, "reject", { reason: "Payment not received" });
  state.store!.data.get("gymSettings/finance")!.studentMonthlyMinor = 150000;
  const quote = await getPurchaseQuote("p1", result.id);
  expect(quote.amountMinor).toBe(100000);
  const replacement = await submitPurchase("customer:p1", "p1", { operationId: "replacement-operation-0001", quoteToken: quote.quoteToken, previousRequestId: result.id, method: "cash" });
  expect(rows("charges")).toHaveLength(1); expect(rows("paymentRequests")).toHaveLength(2);
  expect(state.store!.data.get(`paymentRequests/${replacement.id}`)?.previousRequestId).toBe(result.id);
  await decision(replacement.id); expect(rows("charges")[0][1].confirmedPaymentRequestId).toBe(replacement.id);
});
it("permits reviewed rejection after membership changes without accepting new coverage", async () => {
  const { result } = await request();
  state.store!.data.get("persons/p1")!.membershipExpiry = Timestamp.fromMillis(NOW + 120 * 86400000);
  await decision(result.id, "reject", { reason: "Payment not received" });
  expect(state.store!.data.get(`paymentRequests/${result.id}`)?.status).toBe("rejected");
  expect(state.store!.data.get("persons/p1")!.membershipExpiry).toEqual(Timestamp.fromMillis(NOW + 120 * 86400000));
});
it("prevents concurrent pending purchases and new purchases with unset prices or stale quotes", async () => {
  const quote = await getPurchaseQuote("p1");
  const results = await Promise.allSettled([1, 2].map(i => submitPurchase("customer:p1", "p1", { method: "cash", operationId: `competing-purchase-${i}`, quoteToken: quote.quoteToken })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(rows("charges")).toHaveLength(1);
  state.store!.data.get("gymSettings/finance")!.studentMonthlyMinor = null;
  await expect(getPurchaseQuote("p1")).rejects.toMatchObject({ code: "monthly-price-or-category-unset" });
});
it("requires reviewed GCash evidence and claims a reference only within successful approval", async () => {
  const operation = "gcash-membership-operation-0001", quote = await getPurchaseQuote("p1"), receiptId = "a".repeat(64), receiptToken = "b".repeat(43);
  const chargeId = purchaseChargeId("p1", operation), requestId = purchaseRequestId("p1", operation);
  state.store!.data.set(`receiptIntents/${receiptId}`, { personId: "p1", chargeId, paymentRequestId: requestId, state: "ready", amountMinor: 100000,
    tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 10000 });
  const result = await submitPurchase("customer:p1", "p1", { operationId: operation, quoteToken: quote.quoteToken, method: "gcash", receiptId, receiptToken });
  await expect(decision(result.id)).rejects.toMatchObject({ code: "receipt-review-required" });
  state.store!.data.set(`receiptReviews/${receiptId}`, { confirmedReference: "0001234567890", confirmedAmountMinor: 99999, reviewRevision: 1 });
  await expect(decision(result.id)).rejects.toMatchObject({ code: "receipt-review-required" });
  state.store!.data.get(`receiptReviews/${receiptId}`)!.confirmedAmountMinor = 100000;
  state.store!.data.set("approvedGcashReferences/0001234567890", { paymentRequestId: "other", chargeId: "other" });
  await expect(decision(result.id)).rejects.toMatchObject({ code: "reference-already-used" });
  expect(state.store!.data.get(`paymentRequests/${result.id}`)?.status).toBe("pending");
  state.store!.data.delete("approvedGcashReferences/0001234567890"); await decision(result.id);
  expect(state.store!.data.get("approvedGcashReferences/0001234567890")?.paymentRequestId).toBe(result.id);
});
it("converts a guest only after approved purchase while preserving identity, visits, card and weights", async () => {
  const person = state.store!.data.get("persons/p1")!; person.type = "guest"; person.status = null; person.membershipExpiry = null;
  state.store!.data.set("weightEntries/w1", { personId: "p1", weightKg: 70 });
  const { result } = await request(); expect(state.store!.data.get("persons/p1")?.type).toBe("guest"); await decision(result.id);
  expect(state.store!.data.get("persons/p1")).toMatchObject({ type: "member", visitCount: 42, rfidTagId: "CARD" });
  expect(state.store!.data.get("weightEntries/w1")?.weightKg).toBe(70);
});
