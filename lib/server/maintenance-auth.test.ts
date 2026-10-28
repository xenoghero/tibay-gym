import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), photos: vi.fn(), deleted: vi.fn(), links: vi.fn(), corrections: vi.fn(), orphans: vi.fn() }));
vi.mock("./rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("./private-images", () => ({ cleanupProfileImages: mocks.photos }));
vi.mock("./receipt-cleanup", () => ({ cleanupReceiptRetention: mocks.deleted }));
vi.mock("./receipt-review", () => ({ recoverReceiptCorrections: mocks.corrections }));
vi.mock("./receipt-store", () => ({ cleanupOrphanReceipts: mocks.orphans, recoverReceiptLinks: mocks.links }));
import { requireMaintenanceCaller } from "./maintenance-auth";
import { ApiError } from "./rfid/http";
import { POST as photos } from "@/app/api/images/cleanup/route";
import { POST as receipts } from "@/app/api/receipts/worker/route";
const secret = "synthetic-cron-secret-0001";
const request = (authorization?: string) => new Request("https://test/api/maintenance", { method: "POST", headers: authorization ? { authorization } : {} });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", secret);
  mocks.admin.mockRejectedValue(new ApiError(401, "unauthorized"));
  mocks.photos.mockResolvedValue({ inspected: 0, removed: 0 }); mocks.deleted.mockResolvedValue(0);
  mocks.links.mockResolvedValue(0); mocks.corrections.mockResolvedValue(undefined); mocks.orphans.mockResolvedValue(0);
});
afterEach(() => { vi.unstubAllEnvs(); });
it("accepts only the exact configured scheduled credential without querying Firebase auth", async () => {
  await requireMaintenanceCaller(request(`Bearer ${secret}`)); expect(mocks.admin).not.toHaveBeenCalled();
});
it.each([undefined, "Bearer wrong", `bearer ${secret}`, `Bearer ${secret}x`, `Bearer ${"é".repeat(secret.length)}`])("rejects invalid scheduled credentials without running maintenance: %s", async value => {
  expect((await photos(request(value))).status).toBe(401);
  expect((await receipts(request(value))).status).toBe(401);
  expect(mocks.photos).not.toHaveBeenCalled(); expect(mocks.deleted).not.toHaveBeenCalled(); expect(mocks.links).not.toHaveBeenCalled(); expect(mocks.corrections).not.toHaveBeenCalled(); expect(mocks.orphans).not.toHaveBeenCalled();
});
it.each(["", "short"])("does not accept an unconfigured or short scheduled secret", async configured => {
  vi.stubEnv("CRON_SECRET", configured);
  await expect(requireMaintenanceCaller(request(`Bearer ${configured}`))).rejects.toMatchObject({ status: 401 });
});
it("preserves interactive admin operation when scheduled credentials are absent", async () => {
  vi.stubEnv("CRON_SECRET", ""); mocks.admin.mockResolvedValue("admin");
  expect((await photos(request("Bearer synthetic-admin-token"))).status).toBe(200);
  expect(mocks.photos).toHaveBeenCalledOnce();
});
it("runs both bounded jobs after scheduled authorization and sends uncached responses", async () => {
  const a = await photos(request(`Bearer ${secret}`)), b = await receipts(request(`Bearer ${secret}`));
  expect(a.status).toBe(200); expect(b.status).toBe(200); expect(b.headers.get("cache-control")).toContain("no-store");
  expect(mocks.deleted).toHaveBeenCalledOnce(); expect(mocks.links).toHaveBeenCalledOnce(); expect(mocks.corrections).toHaveBeenCalledOnce(); expect(mocks.orphans).toHaveBeenCalledOnce();
});
