import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { memoryFirestore } from "@/tests/memory-firestore";
import { voucherFixture } from "@/tests/voucher-fixture";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
import type { Voucher } from "@/lib/finance/vouchers";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { saveVoucher, previewVoucher } from "./vouchers";
import { getPurchaseQuote, newProfileQuote, submitPurchase, paymentReviewPreview, decidePayment, abandonPurchase, purchaseChargeId, purchaseRequestId } from "./purchases";
import { mutateAdmin } from "./admin-mutations";
import { scanAttendance } from "./attendance";
import { confirmDailyCash, dailyChargeId } from "./daily-charges";
const NOW = Date.parse("2026-10-29T03:00:00Z");
let sequence = 0;
const store = () => state.store!;
const voucher = () => store().data.get("vouchers/voucher-1")!;
const uses = () => [...store().data].filter(([p]) => p.startsWith("voucherUses/"));
beforeEach(() => {
  state.store = memoryFirestore(); sequence = 0; vi.useFakeTimers(); vi.setSystemTime(NOW);
  store().data.set("vouchers/voucher-1", { ...voucherFixture() }); store().data.set("voucherCodeClaims/TRAIN10", { voucherId: "voucher-1" });
  store().data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, rateRevision: 1, financialCutoverAt: NOW - 1000, studentMonthlyMinor: 100000 });
  for (const id of ["p1", "p2"]) store().data.set(`persons/${id}`, { name: id, phone: id === "p1" ? "09123456789" : "09999999999", type: "guest", status: null, membershipExpiry: null, rateCategory: "student", visitCount: 0 });
});
afterEach(() => vi.useRealTimers());
const preview = (personId = "p1") => previewVoucher({ code: "TRAIN10", personId, kind: "daily_session", category: "student", baseAmountMinor: 6000, at: NOW });
async function purchase(personId = "p1") {
  const quote = await getPurchaseQuote(personId, undefined, "TRAIN10"), body = { voucherCode: "TRAIN10", quoteToken: quote.quoteToken, method: "cash", operationId: `voucher-purchase-operation-${++sequence}` };
  return { ...await submitPurchase(`customer:${personId}`, personId, body), body };
}
async function decide(id: string, decision = "approve") {
  const quote = await paymentReviewPreview(id);
  return decidePayment("admin", { paymentRequestId: id, decision, previewToken: quote.previewToken, reviewed: true, reason: "Payment not received" });
}
it("previews without reserving, creates one reservation per charge and confirms once", async () => {
  await preview(); await preview(); expect(voucher().heldCount).toBe(0); expect(uses()).toHaveLength(0);
  const p = await purchase(); await submitPurchase("customer:p1", "p1", p.body);
  expect(voucher()).toMatchObject({ heldCount: 1, confirmedCount: 0, everUsed: true }); expect(uses()).toHaveLength(1);
  expect(store().data.get(`charges/${p.chargeId}`)).toMatchObject({ amountMinor: 90000, baseAmountMinor: 100000, discountAmountMinor: 10000, unitRateMinor: 100000 });
  await Promise.all([decide(p.id), decide(p.id)]);
  expect(voucher()).toMatchObject({ heldCount: 0, confirmedCount: 1, confirmedDiscountMinor: 10000 });
  expect(uses()[0][1].status).toBe("confirmed");
});
it("prevents last-slot races across different customers and enforces per-person capacity", async () => {
  voucher().totalLimit = 1;
  const q1 = await getPurchaseQuote("p1", undefined, "TRAIN10"), q2 = await getPurchaseQuote("p2", undefined, "TRAIN10");
  const results = await Promise.allSettled(["p1", "p2"].map((id, i) => submitPurchase(`customer:${id}`, id, { voucherCode: "TRAIN10", method: "cash", quoteToken: [q1, q2][i].quoteToken, operationId: `last-slot-purchase-${i}` })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(uses()).toHaveLength(1); expect(voucher().heldCount).toBe(1);
  voucher().totalLimit = 10;
  const personId = uses()[0][1].personId as string;
  await expect(preview(personId)).rejects.toMatchObject({ code: "voucher-customer-limit" });
});
it("invalidates edited previews but preserves submitted terms through pause, expiry and correction", async () => {
  const q = await getPurchaseQuote("p1", undefined, "TRAIN10"); voucher().revision = 2;
  await expect(submitPurchase("customer:p1", "p1", { voucherCode: "TRAIN10", method: "cash", quoteToken: q.quoteToken, operationId: "stale-voucher-operation" })).rejects.toMatchObject({ code: "purchase-quote-changed" });
  const p = await purchase(); await decide(p.id, "reject");
  voucher().status = "paused"; voucher().endsAt = NOW - 1; voucher().value = 5000;
  expect(voucher().heldCount).toBe(1);
  const replacementQuote = await getPurchaseQuote("p1", p.id);
  expect(replacementQuote.amountMinor).toBe(90000);
  const replacement = await submitPurchase("customer:p1", "p1", { method: "cash", previousRequestId: p.id, quoteToken: replacementQuote.quoteToken, operationId: "voucher-replacement-operation" });
  await decide(replacement.id); expect(uses()).toHaveLength(1); expect(voucher().confirmedDiscountMinor).toBe(10000);
});
it("releases abandoned memberships once, blocks correction and rejects closing paid or daily purchases", async () => {
  const p = await purchase();
  const close = { chargeId: p.chargeId, paymentRequestId: p.id, confirmed: true, reason: "Customer withdrew the unpaid request" };
  await Promise.all([abandonPurchase("admin", close), abandonPurchase("admin", close)]);
  expect(voucher()).toMatchObject({ heldCount: 0, confirmedCount: 0 }); expect(uses()[0][1].status).toBe("released");
  await expect(getPurchaseQuote("p1", p.id)).rejects.toMatchObject({ code: "replacement-unavailable" });
  expect(store().data.get("membershipPurchaseState/p1")!.activeRequestId).toBeNull();
  const paid = await purchase(); await decide(paid.id);
  await expect(abandonPurchase("admin", { ...close, chargeId: paid.chargeId, paymentRequestId: paid.id })).rejects.toMatchObject({ code: "purchase-cannot-close" });
});
it("approval and abandonment cannot both settle the same reservation", async () => {
  const p = await purchase(); const review = await paymentReviewPreview(p.id);
  const results = await Promise.allSettled([
    decidePayment("admin", { paymentRequestId: p.id, decision: "approve", reviewed: true, previewToken: review.previewToken }),
    abandonPurchase("admin", { chargeId: p.chargeId, paymentRequestId: p.id, confirmed: true, reason: "Abandoned" }),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(voucher().heldCount).toBe(0); expect(voucher().confirmedCount).toBe(1);
});
it("reuses a discounted daily charge across retry, checkout and same-day return", async () => {
  const input = { source: "qr" as const, personId: "p1", eventId: "daily-voucher-scan-01", requestedAt: NOW, paymentMethod: "cash" as const, expectedAmountMinor: 5400, voucherCode: "TRAIN10", voucherRevision: 1, voucherRateRevision: 1 };
  await scanAttendance(input); await scanAttendance(input);
  vi.setSystemTime(NOW + 30000); await scanAttendance({ ...input, eventId: "daily-voucher-scan-02", requestedAt: Date.now() });
  vi.setSystemTime(NOW + 60000); await scanAttendance({ ...input, eventId: "daily-voucher-scan-03", requestedAt: Date.now() });
  expect(uses()).toHaveLength(1); expect(voucher().heldCount).toBe(1);
  const id = dailyChargeId("p1", NOW);
  await Promise.all([confirmDailyCash("admin", id, 5400), confirmDailyCash("admin", id, 5400)]);
  expect(voucher()).toMatchObject({ heldCount: 0, confirmedCount: 1, confirmedDiscountMinor: 600 });
  await expect(abandonPurchase("admin", { chargeId: id, confirmed: true, reason: "No" })).rejects.toMatchObject({ code: "purchase-cannot-close" });
});
it("binds customer quotes to the intended customer and enforces server-derived purchase kinds", async () => {
  const q = await getPurchaseQuote("p1", undefined, "TRAIN10");
  await expect(submitPurchase("customer:p2", "p2", { voucherCode: "TRAIN10", method: "cash", quoteToken: q.quoteToken, operationId: "cross-customer-quote-01" })).rejects.toMatchObject({ code: "purchase-quote-changed" });
  voucher().kinds = ["renewal"];
  await expect(getPurchaseQuote("p1", undefined, "TRAIN10")).rejects.toMatchObject({ code: "voucher-scope" });
  store().data.get("gymSettings/finance")!.studentMonthlyMinor = null;
  await expect(getPurchaseQuote("p1", undefined, "TRAIN10")).rejects.toMatchObject({ code: "monthly-price-or-category-unset" });
});
it("supports renaming never-submitted codes while retiring their old spelling", async () => {
  const existing = voucher();
  const renamed = await saveVoucher("admin", { ...existing, code: "FRESH10", operationId: "voucher-rename-operation" });
  expect(renamed.code).toBe("FRESH10");
  await expect(preview()).rejects.toMatchObject({ code: "voucher-unavailable" });
  const quote = await previewVoucher({ code: "fresh10", personId: "p1", kind: "daily_session", category: "student", baseAmountMinor: 6000, at: NOW });
  expect(quote.amountMinor).toBe(5400);
  await expect(saveVoucher("admin", { ...voucherFixture(), id: undefined, operationId: "retired-code-reuse-01" })).rejects.toMatchObject({ code: "voucher-code-taken" });
});
it("reserves a new-membership voucher in the same transaction as admin profile creation", async () => {
  const quote = await newProfileQuote("student", "TRAIN10");
  const result = await mutateAdmin("admin", { action: "profile-create", operationId: "voucher-new-profile-01", input: {
    phone: "09888888888", name: "New customer", type: "member", status: "active", joinDate: null, membershipExpiry: null,
    rateCategory: "student", leadSource: "friends", leadSourceOther: null,
  }, financial: { quoteToken: quote.quoteToken, voucherCode: "TRAIN10" } });
  expect(result).toHaveProperty("id"); expect(uses()).toHaveLength(1); expect(uses()[0][1]).toMatchObject({ kind: "new_membership", amountMinor: 90000 });
});
it("binds GCash evidence to the discounted payable amount on submission and approval", async () => {
  const operation = "gcash-voucher-operation", quote = await getPurchaseQuote("p1", undefined, "TRAIN10"), receiptId = "a".repeat(64), receiptToken = "b".repeat(43);
  store().data.set(`receiptIntents/${receiptId}`, { state: "ready", personId: "p1", chargeId: purchaseChargeId("p1", operation), paymentRequestId: purchaseRequestId("p1", operation),
    amountMinor: 100000, tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 100000 });
  const body = { operationId: operation, quoteToken: quote.quoteToken, voucherCode: "TRAIN10", method: "gcash", receiptId, receiptToken };
  await expect(submitPurchase("customer:p1", "p1", body)).rejects.toMatchObject({ code: "valid-receipt-required" });
  expect(uses()).toHaveLength(0);
  store().data.get(`receiptIntents/${receiptId}`)!.amountMinor = 90000;
  const result = await submitPurchase("customer:p1", "p1", body);
  store().data.set(`receiptReviews/${receiptId}`, { confirmedReference: "1234567890123", confirmedAmountMinor: 100000, reviewRevision: 1 });
  await expect(decide(result.id)).rejects.toMatchObject({ code: "receipt-review-required" });
  store().data.get(`receiptReviews/${receiptId}`)!.confirmedAmountMinor = 90000;
  await decide(result.id);
  expect(voucher()).toMatchObject({ heldCount: 0, confirmedCount: 1, confirmedDiscountMinor: 10000 });
  expect(store().data.get(`paymentRequests/${result.id}`)!.amountMinor).toBe(90000);
});
it("rejects changed daily voucher revisions atomically without attendance or capacity writes", async () => {
  await expect(scanAttendance({ source: "qr", personId: "p1", eventId: "daily-stale-voucher", requestedAt: NOW, paymentMethod: "cash", expectedAmountMinor: 5400, voucherCode: "TRAIN10", voucherRevision: 2, voucherRateRevision: 1 })).rejects.toMatchObject({ code: "voucher-changed" });
  expect(uses()).toHaveLength(0); expect(voucher().heldCount).toBe(0);
  expect([...store().data.keys()].some(p => p.startsWith("attendanceLogs/"))).toBe(false);
});
it("saves admin edits idempotently with revision checks, and retains deleted code uniqueness", async () => {
  const config = { ...voucherFixture(), code: "FRESH10", operationId: "voucher-create-operation-01", id: undefined };
  const created = await saveVoucher("admin", config); expect(await saveVoucher("admin", config)).toEqual(created);
  await expect(saveVoucher("admin", { ...created, value: 2000, revision: 0, operationId: "voucher-stale-operation" })).rejects.toMatchObject({ code: "voucher-revision" });
  await saveVoucher("admin", { id: created.id, revision: created.revision, action: "delete", operationId: "voucher-delete-operation" });
  expect(store().data.has(`vouchers/${created.id}`)).toBe(false);
  await expect(saveVoucher("admin", { ...config, operationId: "voucher-reuse-operation" })).rejects.toMatchObject({ code: "voucher-code-taken" });
  const p = await purchase();
  await expect(saveVoucher("admin", { id: "voucher-1", revision: 1, action: "delete", operationId: "voucher-used-delete" })).rejects.toMatchObject({ code: "voucher-used" });
  await saveVoucher("admin", { id: "voucher-1", revision: 1, action: "archive", operationId: "voucher-used-archive" });
  await decide(p.id); expect(voucher().status).toBe("archived"); expect(voucher().confirmedCount).toBe(1);
  expect([...store().data].filter(([path]) => path.startsWith("auditEvents/")).some(([, data]) => (data.relevantAfter as Partial<Voucher>)?.code === "FRESH10")).toBe(true);
});
