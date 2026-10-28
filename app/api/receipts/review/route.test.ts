import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), extract: vi.fn(), correct: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/receipt-extraction", () => ({ extractOpenedReceipt: mocks.extract }));
vi.mock("@/lib/server/receipt-review", () => ({ correctReceipt: mocks.correct }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: vi.fn() }));
vi.mock("@/lib/server/supabase", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/server/receipt-store", () => ({ RECEIPT_TABLE: "tibay_receipts" }));
import { POST } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
const request = (body: unknown) => new Request("https://test/api/receipts/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.extract.mockResolvedValue({ status: "extracted", cached: false }); });
it("requires admin authorization before extraction", async () => {
  mocks.admin.mockRejectedValueOnce(new ApiError(401, "unauthorized"));
  expect((await POST(request({ action: "extract", receiptId: "r1" }))).status).toBe(401);
  expect(mocks.extract).not.toHaveBeenCalled();
});
it("runs the selected receipt immediately and supports an explicit rescan", async () => {
  const response = await POST(request({ action: "extract", receiptId: "r1" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ status: "extracted", cached: false });
  expect(mocks.extract).toHaveBeenCalledWith("r1", false);
  await POST(request({ action: "extract", receiptId: "r2", force: true }));
  expect(mocks.extract).toHaveBeenLastCalledWith("r2", true);
  expect(mocks.correct).not.toHaveBeenCalled();
});
it("rejects queued retries and invalid scan parameters", async () => {
  expect((await POST(request({ action: "retry", receiptId: "r1" }))).status).toBe(400);
  expect((await POST(request({ action: "extract", receiptId: "r1", force: "true" }))).status).toBe(400);
  expect(mocks.extract).not.toHaveBeenCalled();
});
