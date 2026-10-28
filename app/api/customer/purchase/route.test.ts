import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn(), submit: vi.fn(), quote: vi.fn() }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/purchases", () => ({ submitPurchase: mocks.submit, getPurchaseQuote: mocks.quote }));
vi.mock("@/lib/server/receipt-store", () => ({ receiptsAvailable: async () => false, reconcileReceiptLink: vi.fn() }));
import { GET, POST } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
const request = (body: unknown) => new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.customer.mockResolvedValue({ session: { personId: "self" }, official: true }); mocks.submit.mockResolvedValue({ id: "request" }); });
it("binds submitted purchases to the server session, ignoring a forged target/actor", async () => {
  expect((await POST(request({ personId: "other", actorId: "admin", method: "cash" }))).status).toBe(200);
  expect(mocks.submit).toHaveBeenCalledWith("customer:self", "self", { personId: "other", actorId: "admin", method: "cash" });
});
it("requires a verified profile and an authenticated customer session", async () => {
  mocks.customer.mockResolvedValueOnce({ session: { personId: "self" }, official: false });
  expect((await POST(request({}))).status).toBe(409); expect(mocks.submit).not.toHaveBeenCalled();
  mocks.customer.mockRejectedValue(new ApiError(401, "customer-session-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(401); expect(mocks.quote).not.toHaveBeenCalled();
});
