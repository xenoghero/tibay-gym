import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/finance-settings", () => ({ getFinanceSettings: mocks.get, saveFinanceSettings: mocks.save }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); });
it("denies settings reads and writes before accessing storage", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(403);
  expect((await POST(new Request("https://test/api", { method: "POST" }))).status).toBe(403);
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("passes verified actor identity and bounds JSON input", async () => {
  mocks.save.mockResolvedValue({ rateRevision: 1 });
  const response = await POST(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorId: "forged" }) }));
  expect(response.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith("admin", { actorId: "forged" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const oversized = await POST(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(3000) }) }));
  expect(oversized.status).toBe(413);
});
