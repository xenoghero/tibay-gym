import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, remove: vi.fn(), update: vi.fn(), metadataError: false }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { private_object_path: "private/evidence.webp" }, error: mocks.metadataError ? {} : null }) }) }),
    update: (value: unknown) => { mocks.update(value); return { eq: async () => ({ error: null }) }; },
  }), storage: { from: () => ({ remove: mocks.remove }) },
}) }));
import { cleanupReceiptRetention } from "./receipt-cleanup";
import { readReceiptRetention, saveReceiptRetention } from "./receipt-retention";
import { DEFAULT_RECEIPT_RETENTION as defaults } from "@/lib/receipt-retention";
const body = () => ({ receiptId: "r1", operationId: "retention-operation-0001", expectedRevision: 0, disputeHold: true, legalHold: false, filingDeadline: null, filedAt: null });
beforeEach(() => {
  vi.clearAllMocks(); mocks.store = memoryFirestore(); mocks.metadataError = false; mocks.remove.mockResolvedValue({ error: null });
  mocks.store.data.set("receiptIntents/r1", { linked: true, personId: "p1", paymentRequestId: "pay1" });
  mocks.store.data.set("paymentRequests/pay1", { status: "rejected", reviewedAt: Date.now() - 181 * 86400000, receiptId: "r1" });
});
it("audits idempotent hold changes, rejects stale/conflicting updates and permits release", async () => {
  await saveReceiptRetention("admin", body()); await saveReceiptRetention("admin", body());
  expect((await readReceiptRetention("r1")).policy).toMatchObject({ disputeHold: true, revision: 1 });
  expect([...mocks.store!.data.keys()].filter(key => key.startsWith("auditEvents/"))).toHaveLength(1);
  await expect(saveReceiptRetention("admin", { ...body(), legalHold: true })).rejects.toMatchObject({ code: "operation-conflict" });
  await expect(saveReceiptRetention("admin", { ...body(), operationId: "retention-operation-0002" })).rejects.toMatchObject({ code: "retention-policy-changed" });
  await saveReceiptRetention("admin", { ...body(), operationId: "retention-operation-0002", expectedRevision: 1, disputeHold: false });
  expect(await cleanupReceiptRetention()).toBe(1);
});
it("preserves final payment records while fencing OCR, deleting private evidence and auditing once", async () => {
  const payment = { ...mocks.store!.data.get("paymentRequests/pay1")! };
  expect(await cleanupReceiptRetention()).toBe(1);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ raw_text: null, claim_token: null, artifact_deleted_at: expect.any(String) }));
  expect(mocks.remove).toHaveBeenCalledWith(["private/evidence.webp"]);
  expect(mocks.store!.data.get("paymentRequests/pay1")).toEqual(payment);
  expect(await cleanupReceiptRetention()).toBe(0);
  expect([...mocks.store!.data.keys()].filter(key => key.startsWith("auditEvents/"))).toHaveLength(1);
});
it.each(["pending", "approved", "missing"])("keeps %s evidence protected after customer deletion", async status => {
  if (status === "missing") mocks.store!.data.delete("paymentRequests/pay1");
  else mocks.store!.data.get("paymentRequests/pay1")!.status = status;
  mocks.store!.data.set("artifactDeletionJobs/p1", { createdAt: Date.now() });
  expect(await cleanupReceiptRetention()).toBe(0); expect(mocks.remove).not.toHaveBeenCalled();
});
it.each(["disputeHold", "legalHold"])("honors %s even for deleted customers", async field => {
  mocks.store!.data.set("receiptRetention/r1", { ...defaults, [field]: true });
  expect(await cleanupReceiptRetention()).toBe(0); expect(mocks.remove).not.toHaveBeenCalled();
});
it("recovers a storage failure after fencing, and refuses late holds after removal starts", async () => {
  mocks.remove.mockResolvedValueOnce({ error: {} });
  await expect(cleanupReceiptRetention()).rejects.toMatchObject({ code: "receipt-retention-cleanup-pending" });
  expect(mocks.store!.data.get("receiptRetention/r1")?.purgeState).toBe("purging");
  await expect(saveReceiptRetention("admin", { ...body(), expectedRevision: 1 })).rejects.toMatchObject({ code: "receipt-removal-started" });
  expect(await cleanupReceiptRetention()).toBe(1);
});
it("leaves metadata failures retryable without touching storage", async () => {
  mocks.metadataError = true;
  await expect(cleanupReceiptRetention()).rejects.toMatchObject({ code: "receipt-retention-cleanup-pending" });
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.metadataError = false; expect(await cleanupReceiptRetention()).toBe(1);
});
it("requires real filing dates for approved evidence and refuses invalid dates or future actual filings", async () => {
  mocks.store!.data.get("paymentRequests/pay1")!.status = "approved";
  const dates = { filingDeadline: "2027-04-15", filedAt: "2027-04-10" };
  await expect(saveReceiptRetention("admin", { ...body(), ...dates })).rejects.toMatchObject({ code: "invalid-accounting-period" });
  await expect(saveReceiptRetention("admin", { ...body(), filingDeadline: "2026-02-30", filedAt: "2026-03-01" })).rejects.toMatchObject({ code: "invalid-filing-date" });
  await expect(saveReceiptRetention("admin", { ...body(), disputeHold: "true" })).rejects.toMatchObject({ code: "invalid-retention-policy" });
});
it("saves a confirmed filing period and removes approved evidence only when that date passes", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-28T00:00:00Z"));
  try {
    mocks.store!.data.set("paymentRequests/pay1", { status: "approved", reviewedAt: Date.parse("2024-10-01T00:00:00Z") });
    await saveReceiptRetention("admin", { ...body(), disputeHold: false, filingDeadline: "2025-04-15", filedAt: "2025-04-10" });
    const policy = (await readReceiptRetention("r1")).policy;
    expect(policy.accountingDeleteAfter).toBe(Date.parse("2030-04-16T00:00:00+08:00"));
    expect(await cleanupReceiptRetention()).toBe(0);
    clock.mockReturnValue(policy.accountingDeleteAfter!);
    expect(await cleanupReceiptRetention()).toBe(1);
  } finally { clock.mockRestore(); }
});
it("rotates past protected first-page evidence so later eligible receipts cannot starve", async () => {
  mocks.store!.data.clear();
  for (let i = 0; i < 26; i++) {
    mocks.store!.data.set(`receiptIntents/r${String(i).padStart(2, "0")}`, { linked: true, personId: "p1", paymentRequestId: `p${i}` });
    mocks.store!.data.set(`paymentRequests/p${i}`, { status: i === 25 ? "rejected" : "pending", reviewedAt: Date.now() - 181 * 86400000 });
  }
  expect(await cleanupReceiptRetention()).toBe(0);
  expect(await cleanupReceiptRetention()).toBe(1);
});
it("serializes holds against concurrent cleanup claims", async () => {
  await Promise.all([saveReceiptRetention("admin", body()), cleanupReceiptRetention()]);
  expect(mocks.remove).not.toHaveBeenCalled();
});
