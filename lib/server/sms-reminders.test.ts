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

const pkg = (extra: Record<string, unknown> = {}) => ({ id: "pkg-1", personId: "p2", chargeId: "pkg-1", paymentRequestId: "r", packageId: "pkg-8", priceMinor: 150000,
  sessions: 8, validityDays: 15, status: "active", submittedAt: now - 20 * DAY, approvedAt: now - 20 * DAY, startedAt: now - 12 * DAY,
  // Last day of coaching is 3 days from today (Oct 31); validity ends Nov 1 00:00 Manila.
  coachingExpiresAt: Date.parse("2026-11-01T00:00:00+08:00"), sessionsUsed: 5, topUpSessions: 0, ...extra });
const coachingMessages = () => [...data()].filter(([key, value]) => key.startsWith("smsMessages/") && value.purpose === "coaching_expiry").map(([, value]) => value);
function coachingClient(extra: Record<string, unknown> = {}) {
  data().set("persons/p2", { type: "guest", phone: "09171234568", membershipExpiry: null, lastVisitAt: now });
  data().set("smsContacts/p2", { phone: "+639171234568", permission: true, optedOut: false });
  data().set("coachingPackages/pkg-1", pkg(extra));
}
it("texts a client 3 days before coaching ends when sessions are left, once across retries", async () => {
  coachingClient();
  await scanSmsReminders(); await scanSmsReminders();
  expect(coachingMessages()).toEqual([expect.objectContaining({ personId: "p2", coachingPackageId: "pkg-1", status: "queued",
    text: expect.stringContaining("ends on 2026-10-31") })]);
  await runSmsWorker();
  expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ destination: "+639171234568", purpose: "coaching_expiry" }));
});
it("sends nothing when no sessions are left, and cancels a queued text once they are used", async () => {
  coachingClient({ sessionsUsed: 8 });
  await scanSmsReminders(); expect(coachingMessages()).toHaveLength(0);
  data().set("coachingPackages/pkg-1", pkg());
  await scanSmsReminders(); data().set("coachingPackages/pkg-1", pkg({ sessionsUsed: 8 }));
  await runSmsWorker();
  expect(coachingMessages()).toEqual([expect.objectContaining({ status: "cancelled", errorCode: "reminder-obsolete" })]);
  // Opted-out clients get nothing.
  data().set("coachingPackages/pkg-1", pkg({ coachingExpiresAt: pkg().coachingExpiresAt + DAY })); data().get("smsContacts/p2")!.optedOut = true;
  vi.spyOn(Date, "now").mockReturnValue(now + DAY);
  await scanSmsReminders(); expect(coachingMessages()).toHaveLength(1);
});
it("applies the automatic 15-day Package start for packages it reads", async () => {
  coachingClient({ status: "approved", approvedAt: now - 16 * DAY, startedAt: null, coachingExpiresAt: null });
  await scanSmsReminders();
  expect(data().get("coachingPackages/pkg-1")).toMatchObject({ status: "active", startedAt: now - DAY });
  expect(data().get("persons/p2")).toMatchObject({ type: "member", status: "active" });
});
