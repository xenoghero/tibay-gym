import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), settings: vi.fn(), worker: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/sms-provider", () => ({ smsProviderReady: () => false }));
vi.mock("@/lib/server/sms", () => ({ getSmsSettings: mocks.settings, runSmsWorker: mocks.worker, queueSmsTest: mocks.queue,
  saveSmsSettings: vi.fn(), saveSmsContact: vi.fn(), smsHistory: async () => ({ messages: [], next: null }) }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.settings.mockResolvedValue({ enabled: false }); });
it("rejects unauthenticated readers and writers before accessing settings or queue", async () => {
  mocks.admin.mockRejectedValue(new ApiError(401, "unauthorized"));
  expect((await GET(new Request("http://localhost/api/sms/admin"))).status).toBe(401);
  expect((await POST(new Request("http://localhost/api/sms/admin", { method: "POST" }))).status).toBe(401);
  expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
});
it("returns private uncached history and no credentials", async () => {
  const response = await GET(new Request("http://localhost/api/sms/admin"));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ settings: { enabled: false }, configured: false, messages: [], next: null });
});
it("does not run a worker for unknown actions", async () => {
  const response = await POST(new Request("http://localhost/api/sms/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "blast" }) }));
  expect(response.status).toBe(400); expect(mocks.worker).not.toHaveBeenCalled();
});
