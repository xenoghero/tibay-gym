import { expect, it } from "vitest";
import { DEFAULT_SMS_SETTINGS } from "./contracts";
import { dueReminders, reminderStillCurrent } from "./reminders";
const now = Date.parse("2026-10-28T09:00:00+08:00"), DAY = 86_400_000;
const member = (days: number) => ({ type: "member", membershipExpiry: now + days * DAY, lastVisitAt: now });
it.each([7, 5, 1])("queues exactly the %s-day expiry point", days => {
  const [candidate] = dueReminders("p1", member(days), DEFAULT_SMS_SETTINGS, now);
  expect(candidate.reminderOffset).toBe(days); expect(candidate.text).toContain(`${days} days`);
});
it.each([8, 6, 4, 2, 0, -1])("does not catch up a missed reminder at %s days", days => {
  expect(dueReminders("p1", member(days), DEFAULT_SMS_SETTINGS, now)).toEqual([]);
});
it("uses Philippine calendar dates and waits for configured time", () => {
  expect(dueReminders("p1", member(7), DEFAULT_SMS_SETTINGS, now - 1)).toEqual([]);
  const late = Date.parse("2026-10-28T23:59:00+08:00");
  expect(dueReminders("p1", { ...member(7), membershipExpiry: Date.parse("2026-11-04T00:00:00+08:00") }, DEFAULT_SMS_SETTINGS, late)[0].reminderOffset).toBe(7);
});
it("requires more than ten days of inactivity and never fabricates a first visit", () => {
  expect(dueReminders("p1", { type: "member", lastVisitAt: now - 10 * DAY }, DEFAULT_SMS_SETTINGS, now)).toEqual([]);
  expect(dueReminders("p1", { type: "member", lastVisitAt: null }, DEFAULT_SMS_SETTINGS, now)).toEqual([]);
  const [first] = dueReminders("p1", { type: "member", lastVisitAt: now - 10 * DAY - 1 }, DEFAULT_SMS_SETTINGS, now);
  expect(first.purpose).toBe("inactivity");
  expect(dueReminders("p1", { type: "member", lastVisitAt: now - 10 * DAY - 1 }, DEFAULT_SMS_SETTINGS, now + DAY)[0].key).toBe(first.key);
});
it("cancels obsolete expiry and inactivity snapshots but waits for a later configured time", () => {
  const person = member(7), candidate = dueReminders("p1", person, DEFAULT_SMS_SETTINGS, now)[0];
  const message = { ...candidate };
  expect(reminderStillCurrent(message, person, DEFAULT_SMS_SETTINGS, now)).toBe("current");
  expect(reminderStillCurrent(message, person, { ...DEFAULT_SMS_SETTINGS, sendTime: "10:00" }, now)).toBe("wait");
  expect(reminderStillCurrent(message, member(8), DEFAULT_SMS_SETTINGS, now)).toBe("obsolete");
  expect(reminderStillCurrent(message, person, DEFAULT_SMS_SETTINGS, now + DAY)).toBe("obsolete");
  expect(reminderStillCurrent({ ...message, purpose: "inactivity", lastVisitSnapshot: now - 11 * DAY }, person, DEFAULT_SMS_SETTINGS, now)).toBe("obsolete");
});
