import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "./memory-firestore";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => state.store!.db }));
vi.mock("@/lib/server/public-rate-limit", () => ({ publicCaller: () => "synthetic", publicRateLimiter: { consume: vi.fn() } }));
vi.mock("@/lib/server/rfid/rate-limit", () => ({ throttle: vi.fn() }));
// External receipt storage is deliberately unavailable. The durable correction outbox must survive it.
vi.mock("@/lib/server/supabase", () => ({ supabaseAdmin: () => { throw new Error("Synthetic storage interruption"); } }));
import { POST as scan } from "@/app/api/attendance/scan/route";
import { GET as customerPayments } from "@/app/api/customer/payments/route";
import { approveUnverified } from "@/lib/server/unverified";
import { createCustomerSession, requireCustomer } from "@/lib/server/customer-session";
import { getPurchaseQuote, submitPurchase, paymentReviewPreview, decidePayment, purchaseChargeId, purchaseRequestId } from "@/lib/server/purchases";
import { mutateAdmin } from "@/lib/server/admin-mutations";
import { correctReceipt } from "@/lib/server/receipt-review";
import { financeReport } from "@/lib/server/finance-report";
import { deleteProfile } from "@/lib/server/attendance-admin";
const NOW = Date.parse("2026-10-26T02:00:00Z");
const rows = (name: string) => [...state.store!.data].filter(([path]) => path.startsWith(`${name}/`));
const request = (body: unknown) => new Request("https://synthetic.test/api/attendance/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const customer = (token: string) => new Request("https://synthetic.test/api/customer/payments", { headers: { cookie: `tibay_customer=${token}` } });
async function decision(id: string, value = "approve", extra = {}) {
  const preview = await paymentReviewPreview(id);
  return decidePayment("admin", { paymentRequestId: id, decision: value, reviewed: true, previewToken: preview.previewToken, ...extra });
}
beforeEach(() => {
  state.store = memoryFirestore(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  // Test prices only: never written to a live project.
  state.store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: NOW - 1, studentMonthlyMinor: 100000, regularMonthlyMinor: 120000 });
});
afterEach(() => { vi.useRealTimers(); });
it.each([ ["student", "cash", 6000, 100000], ["regular", "gcash", 7000, 120000] ] as const)("reconciles %s registration, daily rejection, %s purchase approval, customer status and deletion", async (category, method, dailyAmount, monthlyAmount) => {
  const body = { eventId: `registration-event-${category}`, requestedAt: NOW, paymentMethod: "cash", expectedAmountMinor: dailyAmount,
    guest: { name: "Synthetic private name", phone: "09999999999", address: "Synthetic private address", rateCategory: category, leadSource: "friends" } };
  const registered = await scan(request(body)); expect(registered.status).toBe(200);
  const { personId } = await registered.json();
  expect((await scan(request(body))).status).toBe(200); expect(rows("charges")).toHaveLength(1);
  const { token } = await createCustomerSession("09999999999");
  expect((await requireCustomer(customer(token))).official).toBe(false);
  await approveUnverified(personId, "admin");
  expect((await requireCustomer(customer(token))).official).toBe(true);
  expect(state.store!.data.get(`persons/${personId}`)?.visitCount).toBe(1);
  const dailyRequest = rows("paymentRequests")[0][0].split("/")[1];
  await decision(dailyRequest, "reject", { reason: "Cash not received" });
  expect(rows("attendanceLogs")).toHaveLength(1); expect(rows("charges")[0][1].personId).toBe(personId);
  await mutateAdmin("admin", { action: "weight-create", operationId: `weight-operation-${category}`, personId, input: { weightKg: 65.5, measuredAt: { $timestamp: NOW } } });
  const quote = await getPurchaseQuote(personId), operation = `membership-operation-${category}`;
  const receiptId = "a".repeat(64), receiptToken = "b".repeat(43);
  if (method === "gcash") {
    // Represents the already-tested upload boundary, not live upload verification.
    state.store!.data.set(`receiptIntents/${receiptId}`, { state: "ready", personId, chargeId: purchaseChargeId(personId, operation), paymentRequestId: purchaseRequestId(personId, operation), amountMinor: monthlyAmount,
      tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 60_000 });
  }
  const payload = { operationId: operation, method, quoteToken: quote.quoteToken, ...(method === "gcash" ? { receiptId, receiptToken } : {}) };
  const [purchase, retry] = await Promise.all([submitPurchase(`customer:${personId}`, personId, payload), submitPurchase(`customer:${personId}`, personId, payload)]);
  expect(purchase).toEqual(retry); expect(rows("charges")).toHaveLength(2);
  expect(state.store!.data.get(`persons/${personId}`)?.type).toBe("guest");
  expect((await (await customerPayments(customer(token))).json()).requests.find((row: { id: string }) => row.id === purchase.id).status).toBe("pending");
  if (method === "gcash") {
    await expect(decision(purchase.id)).rejects.toMatchObject({ code: "receipt-review-required" });
    await correctReceipt("admin", { receiptId, operationId: "correction-operation-0001", reference: "0001234567890", amountMinor: monthlyAmount, expectedRevision: 0, reason: "Synthetic evidence reviewed" });
    expect(rows("receiptCorrectionOutbox")).toHaveLength(1);
  }
  await Promise.all([decision(purchase.id), decision(purchase.id)]);
  expect(rows("statusChanges")).toHaveLength(1); expect(rows("weightEntries")[0][1].weightKg).toBe(65.5);
  expect(state.store!.data.get(`persons/${personId}`)).toMatchObject({ type: "member", status: "active", visitCount: 1 });
  expect((await (await customerPayments(customer(token))).json()).requests.find((row: { id: string }) => row.id === purchase.id).status).toBe("approved");
  vi.setSystemTime(NOW + 30_000);
  expect((await scan(request({ eventId: `checkout-event-${category}`, requestedAt: Date.now(), personId }))).status).toBe(200);
  vi.setSystemTime(NOW + 60_000);
  expect((await scan(request({ eventId: `covered-event-${category}`, requestedAt: Date.now(), personId }))).status).toBe(200);
  expect(rows("charges")).toHaveLength(2); expect(rows("attendanceLogs")).toHaveLength(2);
  const report = await financeReport(new URLSearchParams({ date: "2026-10-26" }));
  expect(report.totals).toMatchObject({ expectedMinor: dailyAmount + monthlyAmount, confirmedMinor: monthlyAmount, confirmedCount: 1, pendingDailyMinor: 0 });
  state.store!.data.get("gymSettings/finance")!.studentDailyMinor = 9000;
  await deleteProfile(personId, "admin");
  const retained = await financeReport(new URLSearchParams({ date: "2026-10-26" })); expect(retained.totals).toEqual(report.totals);
  await expect(requireCustomer(customer(token))).rejects.toMatchObject({ status: 401 });
  expect(JSON.stringify([...rows("charges"), ...rows("paymentRequests"), ...rows("auditEvents")])).not.toMatch(/Synthetic private|09999999999|birthDate|profileImagePath/);
  expect(state.store!.data.has(`artifactDeletionJobs/${personId}`)).toBe(true);
});
