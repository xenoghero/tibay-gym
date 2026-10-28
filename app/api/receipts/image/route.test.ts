import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), customer: vi.fn(), storage: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
vi.mock("@/lib/server/receipt-store", () => ({ RECEIPT_BUCKET: "payment-receipts", RECEIPT_TABLE: "tibay_receipts" }));
vi.mock("@/lib/server/supabase", () => ({ supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { person_id: "other", private_object_path: "private" }, error: null }) }) }) }), storage: { from: mocks.storage } }) }));
import { GET } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
beforeEach(() => { vi.clearAllMocks(); mocks.customer.mockResolvedValue({ session: { personId: "self" } }); });
it("prevents cross-customer receipt viewing before downloading any object", async () => {
  expect((await GET(new Request("https://test/api?id=receipt"))).status).toBe(403);
  expect(mocks.storage).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
});
it("denies forged admin credentials and absent customer sessions before object access", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required")); mocks.customer.mockRejectedValue(new ApiError(401, "customer-session-required"));
  expect((await GET(new Request("https://test/api?id=receipt", { headers: { authorization: "forged" } }))).status).toBe(403);
  expect((await GET(new Request("https://test/api?id=receipt"))).status).toBe(401);
  expect(mocks.storage).not.toHaveBeenCalled();
});
it("hides evidence as soon as retention removal starts, including failed storage cleanup", async () => {
  mocks.admin.mockResolvedValue("admin");
  mocks.db.mockReturnValue({ doc: () => ({ get: async () => ({ data: () => ({ purgeState: "purging" }) }) }) });
  expect((await GET(new Request("https://test/api?id=receipt", { headers: { authorization: "Bearer admin" } }))).status).toBe(404);
  expect(mocks.storage).not.toHaveBeenCalled();
});
