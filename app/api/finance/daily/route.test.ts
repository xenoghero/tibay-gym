import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/daily-charges", () => ({ confirmDailyCash: mocks.confirm }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: vi.fn() }));
import { GET, POST } from "./route";
import { adminDb } from "@/lib/server/firebase-admin";
import { memoryFirestore } from "@/tests/memory-firestore";
import { ApiError } from "@/lib/server/rfid/http";
const request = (body: unknown) => new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.confirm.mockResolvedValue({ ok: true }); });
it("requires admin authorization and an explicit reviewed cash action", async () => {
  mocks.admin.mockRejectedValueOnce(new ApiError(403, "admin-required"));
  expect((await POST(request({ chargeId: "charge" }))).status).toBe(403);
  expect((await POST(request({ chargeId: "charge", expectedAmountMinor: 6000 }))).status).toBe(400);
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect((await POST(request({ chargeId: "charge", expectedAmountMinor: 6000, reviewed: true }))).status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledWith("admin", "charge", 6000);
});

it("lists each visit once and resolves the collected method even without an active request", async () => {
  const { db, data } = memoryFirestore();
  vi.mocked(adminDb).mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
  data.set("charges/scanner", { kind: "daily_session", personId: "deleted", createdAt: 2, confirmedPaymentRequestId: "cash-confirmed" });
  data.set("paymentRequests/cash-confirmed", { chargeId: "scanner", method: "cash", status: "approved" });
  data.set("charges/replacement", { kind: "daily_session", personId: "person", createdAt: 1, activePaymentRequestId: "new-payment" });
  data.set("persons/person", { name: "Ana Santos" });
  data.set("paymentRequests/new-payment", { chargeId: "replacement", method: "gcash", status: "pending", receiptId: "receipt" });
  data.set("receiptReviews/receipt", { confirmedReference: "GC-123" });
  const response = await GET(new Request("https://test/api/finance/daily"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.charges).toHaveLength(2);
  expect(body.charges[0]).toMatchObject({ id: "scanner", customerName: "Deleted customer", paymentMethod: "cash", paymentStatus: "approved" });
  expect(body.charges[1]).toMatchObject({ id: "replacement", customerName: "Ana Santos", paymentMethod: "gcash", paymentStatus: "pending", gcashReference: "GC-123" });
});

it("returns the full daily payment history with replacements and excludes other visits", async () => {
  const { db, data } = memoryFirestore();
  vi.mocked(adminDb).mockReturnValue(db as unknown as ReturnType<typeof adminDb>);
  data.set("charges/visit", { kind: "daily_session" });
  data.set("charges/membership", { kind: "renewal" });
  data.set("paymentRequests/original", { chargeId: "visit", submittedAt: 1, status: "rejected", rejectionReason: "Wrong amount" });
  data.set("paymentRequests/replacement", { chargeId: "visit", submittedAt: 2, status: "approved", previousRequestId: "original" });
  data.set("paymentRequests/unrelated", { chargeId: "other", submittedAt: 3 });
  const response = await GET(new Request("https://test/api/finance/daily?chargeId=visit"));
  expect((await response.json()).payments).toEqual([
    expect.objectContaining({ id: "replacement", previousRequestId: "original" }),
    expect.objectContaining({ id: "original", rejectionReason: "Wrong amount" }),
  ]);
  expect((await GET(new Request("https://test/api/finance/daily?chargeId=membership"))).status).toBe(404);
  mocks.admin.mockRejectedValueOnce(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api/finance/daily?chargeId=visit"))).status).toBe(403);
});
