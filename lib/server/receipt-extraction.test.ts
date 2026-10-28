import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, rows: new Map<string, Row>(), extract: vi.fn(), download: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./receipt-ocr", () => ({ extractReceipt: mocks.extract }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({
  storage: { from: () => ({ download: mocks.download }) },
  from: () => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | undefined;
    const run = () => {
      const rows = [...mocks.rows.values()].filter(row => filters.every(([key, value]) => row[key] === value));
      if (patch) rows.forEach(row => Object.assign(row, patch));
      return { error: null, data: rows.map(row => ({ ...row })) };
    };
    const chain = {
      select: () => chain,
      update: (values: Row) => { patch = values; return chain; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      single: async () => { const result = run(); return { data: result.data[0], error: result.data.length === 1 ? null : {} }; },
      then: <T>(resolve: (value: ReturnType<typeof run>) => T) => Promise.resolve(run()).then(resolve),
    };
    return chain;
  },
}) }));
import { extractOpenedReceipt } from "./receipt-extraction";
beforeEach(() => {
  mocks.store = memoryFirestore(); mocks.rows.clear(); vi.clearAllMocks();
  for (const id of ["r1", "r2"]) {
    mocks.rows.set(id, { id, person_id: "p1", payment_request_id: `pay-${id}`, charge_id: `charge-${id}`, private_object_path: `private/${id}`,
      ocr_status: "needs_review", processed_at: null, attempt_count: 0, claim_token: null, lease_until: null, artifact_deleted_at: null });
    mocks.store.data.set(`receiptIntents/${id}`, { linked: true, personId: "p1", paymentRequestId: `pay-${id}` });
    mocks.store.data.set(`paymentRequests/pay-${id}`, { status: "pending", receiptId: id });
  }
  mocks.store.data.set("persons/p1", { name: "Synthetic customer" });
  mocks.download.mockResolvedValue({ data: new Blob(["synthetic image"]), error: null });
  mocks.extract.mockResolvedValue({ text: "private receipt contents", reference: "0001234567890", amountMinor: 6000, confidence: 95, status: "extracted" });
});
it("scans only the opened receipt, stores a minimal projection and never approves a payment", async () => {
  expect(await extractOpenedReceipt("r2")).toEqual({ status: "extracted", cached: false });
  expect(mocks.download).toHaveBeenCalledWith("private/r2");
  expect(mocks.rows.get("r1")!.ocr_status).toBe("needs_review");
  expect(mocks.store!.data.get("receiptReviews/r2")).toMatchObject({ extractedReference: "0001234567890", extractedAmountMinor: 6000, reviewRevision: 0 });
  expect(JSON.stringify([...mocks.store!.data])).not.toContain("private receipt contents");
  expect(mocks.store!.data.get("paymentRequests/pay-r2")!.status).toBe("pending");
});
it("reuses completed results and preserves manual corrections when explicitly rescanning", async () => {
  await extractOpenedReceipt("r1");
  mocks.store!.data.set("receiptReviews/r1", { confirmedReference: "9991234567890", confirmedAmountMinor: 6500, reviewRevision: 7 });
  expect(await extractOpenedReceipt("r1")).toEqual({ status: "extracted", cached: true });
  expect(mocks.extract).toHaveBeenCalledTimes(1);
  await extractOpenedReceipt("r1", true);
  expect(mocks.extract).toHaveBeenCalledTimes(2);
  expect(mocks.store!.data.get("receiptReviews/r1")).toMatchObject({ confirmedReference: "9991234567890", confirmedAmountMinor: 6500, reviewRevision: 7 });
});
it("shares the in-progress result instead of scanning twice", async () => {
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  mocks.extract.mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); return { text: "", reference: "0001234567890", amountMinor: 6000, confidence: 90, status: "extracted" }; });
  const first = extractOpenedReceipt("r1");
  await entered;
  expect(await extractOpenedReceipt("r1")).toEqual({ status: "processing" });
  finish(); await first;
  expect(mocks.extract).toHaveBeenCalledTimes(1);
});
it("makes a failed scan retryable on the next opening without queuing or financial effects", async () => {
  mocks.extract.mockRejectedValueOnce(new Error("private SDK details"));
  expect(await extractOpenedReceipt("r1")).toEqual({ status: "failed", cached: false });
  expect(JSON.stringify([...mocks.store!.data])).not.toContain("private SDK details");
  expect(await extractOpenedReceipt("r1")).toEqual({ status: "extracted", cached: false });
  expect(mocks.store!.data.get("paymentRequests/pay-r1")!.status).toBe("pending");
});
it("refuses deleted evidence, inactive profiles, unlinked receipts and finalized payments", async () => {
  mocks.store!.data.set("receiptRetention/r1", { purgeState: "purging" });
  await expect(extractOpenedReceipt("r1")).rejects.toMatchObject({ code: "receipt-unavailable" });
  mocks.store!.data.delete("receiptRetention/r1"); mocks.store!.data.delete("persons/p1");
  await expect(extractOpenedReceipt("r1")).rejects.toMatchObject({ code: "receipt-unavailable" });
  mocks.store!.data.set("persons/p1", {}); mocks.store!.data.get("receiptIntents/r1")!.linked = false;
  await expect(extractOpenedReceipt("r1")).rejects.toMatchObject({ code: "receipt-not-linked" });
  mocks.store!.data.get("receiptIntents/r1")!.linked = true; mocks.store!.data.get("paymentRequests/pay-r1")!.status = "approved";
  await expect(extractOpenedReceipt("r1", true)).rejects.toMatchObject({ code: "payment-not-pending" });
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("cannot restore private text after cleanup fences a running scan", async () => {
  mocks.extract.mockImplementationOnce(async () => {
    Object.assign(mocks.rows.get("r1")!, { claim_token: null, artifact_deleted_at: new Date().toISOString() });
    return { text: "private receipt contents", reference: "0001234567890", amountMinor: 6000, confidence: 90, status: "extracted" };
  });
  await expect(extractOpenedReceipt("r1")).rejects.toMatchObject({ code: "receipt-extraction-changed" });
  expect(mocks.rows.get("r1")!.raw_text).toBeUndefined();
  expect(mocks.store!.data.has("receiptReviews/r1")).toBe(false);
});
