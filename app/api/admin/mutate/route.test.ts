import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), mutate: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/admin-mutations", () => ({ mutateAdmin: mocks.mutate }));
import { ApiError } from "@/lib/server/rfid/http";
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("verified-admin"); mocks.mutate.mockResolvedValue({ ok: true }); });
it("rejects unauthorized requests before reading input or changing data", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await POST(new Request("https://test/api", { method: "POST" }))).status).toBe(403);
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("uses the verified actor and rejects oversized request bodies", async () => {
  const request = (body: unknown) => new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await POST(request({ actorId: "forged" }))).status).toBe(200);
  expect(mocks.mutate).toHaveBeenCalledWith("verified-admin", { actorId: "forged" });
  expect((await POST(request({ padding: "x".repeat(9000) }))).status).toBe(413);
});
