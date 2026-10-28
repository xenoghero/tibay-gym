import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/finance-report", () => ({ financeReport: mocks.report }));
import { GET } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin"); mocks.report.mockResolvedValue({ totals: {} }); });
it("authorizes before querying money and never caches private reports", async () => {
  const request = new Request("https://test/api/finance/report?date=2026-10-26");
  mocks.admin.mockRejectedValueOnce(new ApiError(403, "admin-required"));
  expect((await GET(request)).status).toBe(403); expect(mocks.report).not.toHaveBeenCalled();
  const result = await GET(request); expect(result.status).toBe(200); expect(result.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.report.mock.calls[0][0].get("date")).toBe("2026-10-26");
});
