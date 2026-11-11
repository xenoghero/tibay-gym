import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, limit: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./public-rate-limit", () => ({ publicRateLimiter: { consume: mocks.limit } }));
import { resolveAccountPhone } from "./attendance-request";
const person = (phone: string) => ({ phone, phoneLast4: phone.slice(-4) });
beforeEach(() => {
  mocks.store = memoryFirestore(); mocks.limit.mockReset();
  mocks.store.data.set("persons/a", person("09123451111"));
  mocks.store.data.set("persons/b", person("09123452222"));
  mocks.store.data.set("persons/c", person("09998762222"));
  mocks.store.data.set("unverifiedPersons/d", person("09123453333"));
});
it("passes a full number through without spending the short-lookup budget", async () => {
  expect(await resolveAccountPhone("09123451111", "ip")).toBe("09123451111");
  expect(mocks.limit).not.toHaveBeenCalled();
});
it("resolves a unique last 4, including unverified people, and charges the short-lookup budget", async () => {
  expect(await resolveAccountPhone("1111", "ip")).toBe("09123451111");
  expect(await resolveAccountPhone("3333", "ip")).toBe("09123453333");
  expect(mocks.limit).toHaveBeenCalledWith("ip", "shortPhone");
});
it("rejects an unknown last 4 and one shared by different numbers", async () => {
  await expect(resolveAccountPhone("0000", "ip")).rejects.toMatchObject({ status: 404, code: "phone-not-found" });
  await expect(resolveAccountPhone("2222", "ip")).rejects.toMatchObject({ status: 409, code: "phone-ambiguous" });
});
it("counts the same number in both collections once", async () => {
  mocks.store!.data.set("unverifiedPersons/e", person("09123451111"));
  expect(await resolveAccountPhone("1111", "ip")).toBe("09123451111");
});
it.each(["", "111", "11111", "1111a", 1111, null])("rejects malformed value %j", async value => {
  await expect(resolveAccountPhone(value, "ip")).rejects.toMatchObject({ status: 400 });
});
