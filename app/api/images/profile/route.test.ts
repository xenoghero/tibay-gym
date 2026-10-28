import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn(), admin: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
vi.mock("@/lib/server/supabase", () => ({ supabaseAdmin: vi.fn() }));
import { GET } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
beforeEach(() => { vi.clearAllMocks(); mocks.customer.mockResolvedValue({ session: { personId: "self" } }); });
it("does not permit a customer to view another customer's image", async () => {
  expect((await GET(new Request("https://test/api?personId=other"))).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
});
it("rejects unauthenticated image access and forged admin credentials before storage access", async () => {
  mocks.customer.mockRejectedValue(new ApiError(401, "customer-session-required"));
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(401);
  expect((await GET(new Request("https://test/api?personId=other", { headers: { authorization: "forged" } }))).status).toBe(403);
  expect(mocks.db).not.toHaveBeenCalled();
});
