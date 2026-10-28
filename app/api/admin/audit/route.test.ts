import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), db: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), get: vi.fn(), startAfter: vi.fn() }));
vi.mock("@/lib/server/rfid/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
import { ApiError } from "@/lib/server/rfid/http";
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks(); mocks.admin.mockResolvedValue("admin");
  const query = { where: mocks.where, orderBy: mocks.orderBy, limit: mocks.limit, get: mocks.get, startAfter: mocks.startAfter };
  for (const fn of [mocks.where, mocks.orderBy, mocks.limit, mocks.startAfter]) fn.mockReturnValue(query);
  mocks.db.mockReturnValue({ collection: () => query, doc: () => ({ get: async () => ({ exists: false }) }) });
  mocks.get.mockResolvedValue({ size: 0, docs: [] });
});
it("requires admin access before querying audit records", async () => {
  mocks.admin.mockRejectedValue(new ApiError(403, "admin-required"));
  expect((await GET(new Request("https://test/api"))).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
});
it("queries combined filters in Philippine time and caps page size", async () => {
  const response = await GET(new Request("https://test/api?from=2026-10-25&through=2026-10-25&action=profile-update&personId=p1"));
  expect(response.status).toBe(200);
  expect(mocks.where).toHaveBeenCalledWith("action", "==", "profile-update");
  expect(mocks.where).toHaveBeenCalledWith("personId", "==", "p1");
  expect(mocks.where).toHaveBeenCalledWith("occurredAt", ">=", Date.parse("2026-10-24T16:00:00Z"));
  expect(mocks.limit).toHaveBeenCalledWith(51);
  expect(await response.json()).toEqual({ events: [], nextCursor: null });
});
it("returns a next cursor when a page has more than fifty events", async () => {
  mocks.get.mockResolvedValue({ size: 51, docs: Array.from({ length: 51 }, (_, i) => ({ id: `event-${i}`, data: () => ({ occurredAt: i }) })) });
  const result = await (await GET(new Request("https://test/api"))).json();
  expect(result.events).toHaveLength(50); expect(result.nextCursor).toBe("event-49");
});
it.each(["from=2026-02-30", "cursor=missing", "personId=bad/path"])("rejects invalid filter or cursor %s", async query => {
  expect((await GET(new Request(`https://test/api?${query}`))).status).toBe(400);
});
