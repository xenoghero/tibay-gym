import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), get: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/promotions", () => ({ getPromotionSettings: mocks.get, savePromotionSettings: mocks.save, uploadPromotion: mocks.upload }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET, POST, PUT } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); });
it("requires admin authorization before reading, updating, or uploading banners", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  for (const handler of [GET, POST, PUT]) expect((await handler(new Request("https://test"))).status).toBe(403);
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
});
it("uses the authenticated actor and limits metadata request bodies", async () => {
  const body = { revision: 0, banners: [] }; mocks.save.mockResolvedValue({ revision: 1, banners: [] });
  const result = await POST(new Request("https://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  expect(mocks.save).toHaveBeenCalledWith("admin", body);
  const large = await POST(new Request("https://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(9000) }) }));
  expect(large.status).toBe(413);
  const request = new Request("https://test", { method: "PUT" });
  await PUT(request); expect(mocks.upload).toHaveBeenCalledWith("admin", request);
});
