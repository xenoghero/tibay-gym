import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn(), db: vi.fn(), update: vi.fn(), path: vi.fn() }));
vi.mock("@/lib/server/customer-session", () => ({ requireCustomer: mocks.customer }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
vi.mock("@/lib/server/private-images", () => ({ readPrivateImage: vi.fn(), saveProfileImage: vi.fn() }));
import { PATCH } from "./route";
const patch = (body: unknown) => PATCH(new Request("https://test/api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.mockReturnValue({ doc: (path: string) => { mocks.path(path); return { update: mocks.update }; } });
});
it.each([[true, "persons/self"], [false, "unverifiedPersons/self"]])("saves the position on the session's own profile (official=%s)", async (official, path) => {
  mocks.customer.mockResolvedValue({ session: { personId: "self" }, official });
  expect((await patch({ x: 20, y: 80.5 })).status).toBe(200);
  expect(mocks.path).toHaveBeenCalledWith(path);
  expect(mocks.update).toHaveBeenCalledWith({ profileImagePosition: { x: 20, y: 80.5 } });
});
it.each([{ x: -1, y: 0 }, { x: 0, y: 101 }, { x: "5", y: 5 }, { x: 5 }, {}])("rejects invalid position %j", async body => {
  mocks.customer.mockResolvedValue({ session: { personId: "self" }, official: true });
  expect((await patch(body)).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
