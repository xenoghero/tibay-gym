import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/receipt-retention", () => ({ readReceiptRetention: mocks.read, saveReceiptRetention: mocks.save }));
import { GET, POST } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
it("denies unauthenticated reads and writes before accessing retention records", async () => {
  mocks.admin.mockRejectedValue(new ApiError(401, "unauthorized"));
  expect((await GET(new Request("https://test?id=r1"))).status).toBe(401);
  expect((await POST(new Request("https://test", { method: "POST", body: "{}" }))).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
