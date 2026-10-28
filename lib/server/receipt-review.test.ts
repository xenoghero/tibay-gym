import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, unavailable: true }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: () => ({ lt: async () => ({ error: mocks.unavailable ? {} : null }) }) }) }) }) }));
import { correctReceipt } from "./receipt-review";
const body = () => ({ receiptId: "r1", operationId: "receipt-correction-0001", reference: "0001-2345 67890", amountMinor: 6000, reason: "Checked received funds", expectedRevision: 0 });
beforeEach(() => { mocks.store = memoryFirestore(); mocks.unavailable = true;
  mocks.store.data.set("receiptIntents/r1", { linked: true, personId: "p1", chargeId: "c1", paymentRequestId: "pmt1" });
  mocks.store.data.set("paymentRequests/pmt1", { status: "pending" });
});
it("retains an audited review and durable correction when Supabase is unavailable, then syncs on retry", async () => {
  expect(await correctReceipt("admin", body())).toEqual({ reviewRevision: 1 });
  expect(mocks.store!.data.get("receiptReviews/r1")).toMatchObject({ confirmedReference: "0001234567890", confirmedAmountMinor: 6000, reviewRevision: 1 });
  expect(mocks.store!.data.has("receiptCorrectionOutbox/r1")).toBe(true);
  await correctReceipt("admin", body());
  expect([...mocks.store!.data.keys()].filter(path => path.startsWith("auditEvents/"))).toHaveLength(1);
  mocks.unavailable = false; await correctReceipt("admin", body());
  expect(mocks.store!.data.has("receiptCorrectionOutbox/r1")).toBe(false);
  expect([...mocks.store!.data.keys()].some(path => path.startsWith("approvedGcashReferences/"))).toBe(false);
  expect(mocks.store!.data.get("paymentRequests/pmt1")?.status).toBe("pending");
});
it("rejects stale reviews and changes to finalized payments", async () => {
  await correctReceipt("admin", body());
  await expect(correctReceipt("admin", { ...body(), operationId: "receipt-correction-0002" })).rejects.toMatchObject({ code: "receipt-review-changed" });
  mocks.store!.data.get("paymentRequests/pmt1")!.status = "approved";
  await expect(correctReceipt("admin", { ...body(), operationId: "receipt-correction-0003" })).rejects.toMatchObject({ code: "payment-not-pending" });
});
