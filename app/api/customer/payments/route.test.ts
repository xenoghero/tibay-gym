import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn(), db: vi.fn(), where: vi.fn(), get: vi.fn(), docs: new Map<string, Record<string, unknown>>() }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
import { GET } from "./route";
import { ApiError } from "@/lib/server/rfid/http";
beforeEach(() => {
  vi.clearAllMocks(); mocks.docs.clear(); mocks.customer.mockResolvedValue({ session: { personId: "self" } });
  const query = { where: mocks.where, orderBy: () => query, limit: () => query, get: mocks.get };
  mocks.where.mockReturnValue(query);
  mocks.db.mockReturnValue({ collection: () => query, doc: (path: string) => ({ get: async () => ({ id: path.split("/").at(-1), data: () => mocks.docs.get(path) ?? { personId: "other" } }) }) });
  mocks.get.mockResolvedValue({ size: 1, docs: [{ id: "r1", data: () => ({ personId: "self", status: "pending", amountMinor: 6000, method: "cash", submittedAt: 123,
    receiptId: "private", rawText: "private", operationId: "private" }) }] });
});
it("binds queries to the session and returns only limited payment status", async () => {
  const result = await (await GET(new Request("https://test/api?personId=other"))).json();
  expect(mocks.where).toHaveBeenCalledWith("personId", "==", "self");
  expect(result.requests).toEqual([{ id: "r1", status: "pending", amountMinor: 6000, method: "cash", kind: null, submittedAt: 123, rejectionReason: null }]);
  expect(result.pendingMembership).toBeNull();
});
it("returns a limited pending membership outside the current history page", async () => {
  mocks.docs.set("membershipPurchaseState/self", { activeRequestId: "old-request" });
  mocks.docs.set("paymentRequests/old-request", { personId: "self", chargeId: "monthly-charge", status: "pending", amountMinor: 70000,
    method: "cash", submittedAt: 1, receiptId: "private", rawText: "private" });
  mocks.docs.set("charges/monthly-charge", { personId: "self", kind: "new_membership", private: "private" });
  const result = await (await GET(new Request("https://test/api"))).json();
  expect(result.requests.map((row: { id: string }) => row.id)).toEqual(["r1"]);
  expect(result.pendingMembership).toEqual({ id: "old-request", status: "pending", amountMinor: 70000, method: "cash", kind: "new_membership", submittedAt: 1, rejectionReason: null });
});
it.each([
  { personId: "other", status: "pending", kind: "new_membership", abandonedAt: null },
  { personId: "self", status: "approved", kind: "new_membership", abandonedAt: null },
  { personId: "self", status: "pending", kind: "daily_session", abandonedAt: null },
  { personId: "self", status: "pending", kind: "new_membership", abandonedAt: 123 },
])("does not expose an ineligible membership guard target %j", async ({ personId, status, kind, abandonedAt }) => {
  mocks.docs.set("membershipPurchaseState/self", { activeRequestId: "guard-target" });
  mocks.docs.set("paymentRequests/guard-target", { personId, status, chargeId: "charge", method: "cash", amountMinor: 70000, submittedAt: 1 });
  mocks.docs.set("charges/charge", { kind, abandonedAt });
  const result = await (await GET(new Request("https://test/api"))).json();
  expect(result.pendingMembership).toBeNull();
});
it("rejects a cursor belonging to another customer and unauthenticated access", async () => {
  expect((await GET(new Request("https://test/api?cursor=other-request"))).status).toBe(403);
  mocks.customer.mockRejectedValue(new ApiError(401, "customer-session-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(401);
});
