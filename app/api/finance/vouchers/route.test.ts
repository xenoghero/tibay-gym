import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/vouchers", () => ({ listVouchers: mocks.list, saveVoucher: mocks.save }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.list.mockResolvedValue({ records: [] }); mocks.save.mockResolvedValue({ id: "v1" }); });
it("requires admin identity before any voucher or redemption access", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api?id=private-voucher"))).status).toBe(403);
  expect((await POST(new Request("https://test/api", { method: "POST" }))).status).toBe(403);
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("uses the verified actor, bounds bodies, and prevents response caching", async () => {
  const request = (body: unknown) => new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = await POST(request({ actorId: "forged", action: "save" }));
  expect(mocks.save).toHaveBeenCalledWith("admin", { actorId: "forged", action: "save" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await POST(request({ note: "x".repeat(9000) }))).status).toBe(413);
});
