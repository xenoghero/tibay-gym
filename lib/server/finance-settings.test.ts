import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { getFinanceSettings, saveFinanceSettings } from "./finance-settings";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
beforeEach(() => { state.store = memoryFirestore(); });
const input = () => ({ ...DEFAULT_SETTINGS, operationId: "settings-operation-0001" });
it("does not initialize or backfill history on reads", async () => {
  expect(await getFinanceSettings()).toEqual(DEFAULT_SETTINGS);
  expect(state.store!.data.size).toBe(0);
});
it("saves with a stable cutover and serializes concurrent updates", async () => {
  const results = await Promise.allSettled([
    saveFinanceSettings("admin", input()),
    saveFinanceSettings("admin", { ...input(), operationId: "settings-operation-0002", studentDailyMinor: 8000 }),
  ]);
  expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
  const first = await getFinanceSettings();
  const next = await saveFinanceSettings("admin", { ...input(), rateRevision: 1, operationId: "settings-operation-0003", studentDailyMinor: 9000 });
  expect(next.rateRevision).toBe(2);
  expect(next.financialCutoverAt).toBe(first.financialCutoverAt);
});
it("replays a lost response once and rejects conflicting operation reuse", async () => {
  const first = await saveFinanceSettings("admin", input());
  expect(await saveFinanceSettings("admin", input())).toEqual(first);
  await expect(saveFinanceSettings("admin", { ...input(), studentDailyMinor: 8000 })).rejects.toMatchObject({ status: 409 });
  expect((await getFinanceSettings()).rateRevision).toBe(1);
});
