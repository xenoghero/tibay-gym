import { afterEach, beforeEach, expect, it, vi } from "vitest";
type Listener = { next: (snap: { docs: { data: () => unknown }[] }) => void; error: (err: Error) => void; stop: ReturnType<typeof vi.fn> };
const listeners = vi.hoisted(() => [] as Listener[]);
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  collection: () => ({ withConverter: () => ({}) }),
  onSnapshot: (_query: unknown, next: Listener["next"], error: Listener["error"]) => {
    const stop = vi.fn(); listeners.push({ next, error, stop }); return stop;
  },
}));
import type * as PersonModule from "./person";
let listPersons: typeof PersonModule.listPersons, watchAllPersons: typeof PersonModule.watchAllPersons, ROSTER_LINGER_MS: number;

const emit = (listener: Listener, ...names: string[]) => listener.next({ docs: names.map(name => ({ data: () => ({ name }) })) });
beforeEach(async () => {
  vi.useFakeTimers(); listeners.length = 0; vi.resetModules();
  ({ listPersons, watchAllPersons, ROSTER_LINGER_MS } = await import("./person"));
});
afterEach(() => { vi.useRealTimers(); });

it("shares one listener across tabs and keeps it through a tab switch", async () => {
  const overview = vi.fn(), people = vi.fn();
  const stopOverview = watchAllPersons(overview);
  emit(listeners[0], "Ana");
  stopOverview();
  vi.advanceTimersByTime(ROSTER_LINGER_MS - 1);
  watchAllPersons(people);
  expect(listeners).toHaveLength(1);
  expect(people).toHaveBeenCalledWith([{ name: "Ana" }]);
  expect(await listPersons()).toEqual([{ name: "Ana" }]);
  expect(listeners).toHaveLength(1);
  expect(listeners[0].stop).not.toHaveBeenCalled();
});

it("closes after the linger period and reopens on the next subscribe", () => {
  watchAllPersons(vi.fn())();
  vi.advanceTimersByTime(ROSTER_LINGER_MS);
  expect(listeners[0].stop).toHaveBeenCalledOnce();
  watchAllPersons(vi.fn());
  expect(listeners).toHaveLength(2);
});

it("reports an error to every tab and lets a retry open a fresh listener", async () => {
  const onError = vi.fn();
  watchAllPersons(vi.fn(), onError);
  const pending = listPersons();
  listeners[0].error(new Error("permission-denied"));
  expect(onError).toHaveBeenCalledOnce();
  await expect(pending).rejects.toThrow("permission-denied");
  watchAllPersons(vi.fn());
  expect(listeners).toHaveLength(2);
});
