import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn(), db: vi.fn(), where: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
import { GET } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
beforeEach(() => {
  vi.clearAllMocks(); mocks.customer.mockResolvedValue({ session: { personId: "self" } });
  const query = { where: mocks.where, orderBy: () => query, limit: () => query, get: mocks.get };
  mocks.where.mockReturnValue(query);
  mocks.db.mockReturnValue({ collection: () => query, doc: () => ({ get: async () => ({ data: () => ({ personId: "other" }) }) }) });
  mocks.get.mockResolvedValue({ size: 1, docs: [{ id: "r1", data: () => ({ personId: "self", status: "pending", amountMinor: 6000, method: "cash", submittedAt: 123,
    receiptId: "private", rawText: "private", operationId: "private" }) }] });
});
it("binds queries to the session and returns only limited payment status", async () => {
  const result = await (await GET(new Request("https://test/api?personId=other"))).json();
  expect(mocks.where).toHaveBeenCalledWith("personId", "==", "self");
  expect(result.requests).toEqual([{ id: "r1", status: "pending", amountMinor: 6000, method: "cash", submittedAt: 123, rejectionReason: null }]);
});
it("rejects a cursor belonging to another customer and unauthenticated access", async () => {
  expect((await GET(new Request("https://test/api?cursor=other-request"))).status).toBe(403);
  mocks.customer.mockRejectedValue(new ApiError(401, "customer-session-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(401);
});
