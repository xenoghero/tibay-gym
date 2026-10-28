import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
import { DEFAULT_SMS_SETTINGS } from "@/lib/sms/contracts";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, send: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
vi.mock("./sms-provider", () => ({ smsProviderReady: () => true, sendSms: (...args: unknown[]) => state.send(...args), lookupSms: vi.fn() }));
import { scanSmsReminders } from "./sms-reminders";
import { runSmsWorker } from "./sms";
const now = Date.parse("2026-10-28T09:00:00+08:00"), DAY = 86_400_000;
const data = () => state.store!.data;
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now); state.store = memoryFirestore(); state.send.mockReset();
  state.send.mockResolvedValue({ outcome: "accepted", code: 202, state: "Pending" });
  data().set("gymSettings/sms", { ...DEFAULT_SMS_SETTINGS, enabled: true, policyConfirmed: true });
  data().set("persons/p1", { type: "member", phone: "09171234567", membershipExpiry: now + 7 * DAY, lastVisitAt: now - 11 * DAY });
  data().set("smsContacts/p1", { phone: "+639171234567", permission: true, optedOut: false });
});
it("deduplicates repeated/concurrent scans for expiry cycle and inactivity episode", async () => {
  const results = await Promise.all([scanSmsReminders(), scanSmsReminders()]);
  expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(2);
  expect([...data().keys()].filter(key => key.startsWith("smsMessages/"))).toHaveLength(2);
  expect((await scanSmsReminders()).queued).toBe(0);
});
it("cancels both queued messages after renewal and return attendance before sending", async () => {
  await scanSmsReminders(); const person = data().get("persons/p1")!; person.membershipExpiry = now + 30 * DAY; person.lastVisitAt = now;
  await runSmsWorker(); expect(state.send).not.toHaveBeenCalled();
  const messages = [...data()].filter(([key]) => key.startsWith("smsMessages/"));
  expect(messages.every(([, value]) => value.status === "cancelled")).toBe(true);
});
it("previews without queue writes even while disabled and excludes non-consenting members", async () => {
  data().get("gymSettings/sms")!.enabled = false;
  expect((await scanSmsReminders()).disabled).toBe(true);
  expect((await scanSmsReminders(true)).due).toBe(2);
  expect([...data().keys()].some(key => key.startsWith("smsMessages/"))).toBe(false);
  data().get("smsContacts/p1")!.optedOut = true; expect((await scanSmsReminders(true)).due).toBe(0);
});
it("generates a new inactivity episode only after another visit", async () => {
  await scanSmsReminders(); data().get("persons/p1")!.lastVisitAt = now;
  vi.spyOn(Date, "now").mockReturnValue(now + 11 * DAY);
  expect((await scanSmsReminders()).queued).toBe(1);
});
