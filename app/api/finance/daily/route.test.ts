import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/daily-charges", () => ({ confirmDailyCash: mocks.confirm }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: vi.fn() }));
import { POST } from "./route";
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
