import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/payment-methods", () => ({ getPaymentSettings: mocks.get, savePaymentSettings: mocks.save }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("verified-admin"); });
it("authorizes reads and writes before accessing payment accounts", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(403);
  expect((await POST(new Request("https://test/api", { method: "POST" }))).status).toBe(403);
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("uses the verified admin identity and rejects oversized QR settings bodies", async () => {
  mocks.save.mockResolvedValue({ revision: 1, accounts: [] });
  const request = (body: unknown) => new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await POST(request({ actorId: "forged", revision: 0, accounts: [] }))).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith("verified-admin", { actorId: "forged", revision: 0, accounts: [] });
  expect((await POST(request({ padding: "x".repeat(800_001) }))).status).toBe(413);
});
