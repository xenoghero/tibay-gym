import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, row: null as Record<string, unknown> | null,
  upload: vi.fn(), ready: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({ rpc: mocks.ready, storage: { from: () => ({ upload: mocks.upload }) }, from: () => ({
  upsert: async (data: Record<string, unknown>) => { mocks.row ??= data; return { error: null }; },
  select: () => ({ eq: () => ({ single: async () => ({ data: mocks.row, error: null }) }) }),
}) }) }));
import { uploadDailyReceipt, receiptsAvailable } from "./receipt-store";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
import { voucherFixture } from "@/tests/voucher-fixture";
beforeEach(() => { mocks.store = memoryFirestore(); mocks.row = null; vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-private-test-secret");
  mocks.ready.mockResolvedValue({ data: true, error: null }); mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.store.data.set("persons/p1", { rateCategory: "student" }); mocks.store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: Date.now() - 1000 });
});
afterEach(() => vi.unstubAllEnvs());
const input = () => ({ personId: "p1", category: "student", operationId: "receipt-upload-operation-0001", expectedAmountMinor: 6000, bytes: Buffer.from("encoded-image") });
it("binds receipt proof to the full selected membership duration", async () => {
  mocks.store!.data.get("persons/p1")!.type = "member";
  mocks.store!.data.get("gymSettings/finance")!.studentMonthlyMinor = 60000;
  await expect(uploadDailyReceipt({ ...input(), kind: "renewal", months: 3, expectedAmountMinor: 60000 })).rejects.toMatchObject({ code: "daily-price-changed" });
  const proof = await uploadDailyReceipt({ ...input(), kind: "renewal", months: 3, expectedAmountMinor: 180000 });
  expect(mocks.store!.data.get(`receiptIntents/${proof.receiptId}`)).toMatchObject({ amountMinor: 180000, personId: "p1" });
});
it("prepares receipt proof for the discounted total without consuming a voucher use", async () => {
  mocks.store!.data.set("vouchers/voucher-1", { ...voucherFixture() });
  mocks.store!.data.set("voucherCodeClaims/TRAIN10", { voucherId: "voucher-1" });
  const proof = await uploadDailyReceipt({ ...input(), voucherCode: "TRAIN10", expectedAmountMinor: 5400 });
  expect(mocks.store!.data.get(`receiptIntents/${proof.receiptId}`)!.amountMinor).toBe(5400);
  expect(mocks.store!.data.get("vouchers/voucher-1")!.heldCount).toBe(0);
  expect([...mocks.store!.data.keys()].some(path => path.startsWith("voucherUses/"))).toBe(false);
});
it("never recreates removed evidence through an old upload retry", async () => {
  const proof = await uploadDailyReceipt(input());
  mocks.store!.data.get(`receiptIntents/${proof.receiptId}`)!.linked = true;
  await uploadDailyReceipt(input());
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  mocks.store!.data.set(`receiptRetention/${proof.receiptId}`, { purgeState: "purging" });
  await expect(uploadDailyReceipt(input())).rejects.toMatchObject({ code: "receipt-evidence-removed" });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it("still rejects linked upload retries after profile deletion", async () => {
  const proof = await uploadDailyReceipt(input());
  mocks.store!.data.get(`receiptIntents/${proof.receiptId}`)!.linked = true;
  mocks.store!.data.delete("persons/p1"); mocks.store!.data.set("deletedPersonIds/p1", { deletedAt: Date.now() });
  await expect(uploadDailyReceipt(input())).rejects.toMatchObject({ code: "registration-reuse" });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it("keeps GCash unavailable when the schema/security readiness check fails", async () => {
  mocks.ready.mockResolvedValue({ data: false, error: null });
  expect(await receiptsAvailable()).toBe(false);
  await expect(uploadDailyReceipt(input())).rejects.toMatchObject({ code: "receipt-storage-not-ready" });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("recovers interrupted metadata/object steps with one stable ID and no raw proof token at rest", async () => {
  mocks.upload.mockResolvedValueOnce({ error: { statusCode: "503" } });
  await expect(uploadDailyReceipt(input())).rejects.toMatchObject({ code: "receipt-upload-failed" });
  expect(mocks.row).toBeTruthy(); expect(mocks.store!.data.size).toBe(2);
  const proof = await uploadDailyReceipt(input());
  expect(proof.receiptId).toMatch(/^[a-f0-9]{64}$/);
  const intent = mocks.store!.data.get(`receiptIntents/${proof.receiptId}`)!;
  expect(intent).toMatchObject({ state: "ready", linked: false, amountMinor: 6000, personId: "p1" });
  expect(JSON.stringify([...mocks.store!.data])).not.toContain(proof.receiptToken);
  await expect(uploadDailyReceipt({ ...input(), bytes: Buffer.from("different-image") })).rejects.toMatchObject({ code: "receipt-operation-conflict" });
  expect(mocks.upload).toHaveBeenCalledTimes(2);
});
