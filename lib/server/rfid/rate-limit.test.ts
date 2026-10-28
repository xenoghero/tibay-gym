import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), transactions: 0 }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => ({
  collection: () => ({ doc: (id: string) => id }),
  runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    store.transactions++;
    return callback({ get: async (ref: string) => ({ data: () => store.data.get(ref) }),
      set: (ref: string, data: Record<string, unknown>) => store.data.set(ref, data) });
  },
}) }));
import { throttle } from "./rate-limit";
beforeEach(() => { store.data.clear(); store.transactions = 0; vi.useRealTimers(); });
it("shares the durable budget across separate callers and bounds bucket growth", async () => {
  await throttle("device:entrance-01", 2);
  await throttle("device:entrance-01", 2);
  await expect(throttle("device:entrance-01", 2)).rejects.toMatchObject({ status: 429 });
  expect(store.transactions).toBe(3);
  expect(store.data.size).toBe(1);
  expect([...store.data.values()][0].count).toBe(2);
});
it("resets the budget at the next window and supplies TTL retention", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(60_000);
  await throttle("device-auth", 1);
  await expect(throttle("device-auth", 1)).rejects.toMatchObject({ status: 429 });
  vi.setSystemTime(120_000);
  await throttle("device-auth", 1);
  const d = [...store.data.values()][0];
  expect(d.window).toBe(2);
  expect(d.retainUntil).toHaveProperty("toMillis");
  vi.useRealTimers();
});
