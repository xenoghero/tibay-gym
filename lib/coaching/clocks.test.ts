import { expect, it } from "vitest";
import { autoStartDeadline, coachingExpiryMs, membershipMonth, packageStartAt, packageState } from "./clocks";

const at = (iso: string) => Date.parse(iso);
const manila = (ms: number) => new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Manila" });

it("starts at the first use, or exactly 15 days after approval when nobody came in", () => {
  const approved = at("2026-11-01T03:00:00Z");
  expect(autoStartDeadline(approved)).toBe(at("2026-11-16T03:00:00Z"));
  expect(packageStartAt(approved, at("2026-11-05T10:00:00Z"))).toBe(at("2026-11-05T10:00:00Z"));
  expect(packageStartAt(approved, at("2026-11-20T10:00:00Z"))).toBe(at("2026-11-16T03:00:00Z"));
});

it("counts coaching validity in Manila calendar days from the start day, plus days frozen", () => {
  // 7 days starting on Nov 18 (Manila) run through Nov 24 and end at Nov 25 00:00 Manila.
  expect(manila(coachingExpiryMs(at("2026-11-17T16:30:00Z"), 7))).toBe("2026-11-25 00:00:00");
  // Just before Manila midnight still counts as the earlier day.
  expect(manila(coachingExpiryMs(at("2026-11-17T15:59:00Z"), 7))).toBe("2026-11-24 00:00:00");
  expect(manila(coachingExpiryMs(at("2026-12-20T02:00:00Z"), 15, 3))).toBe("2027-01-07 00:00:00");
});

it("places the membership month after any membership already paid for, clamping month ends", () => {
  const start = at("2026-01-31T02:00:00Z");
  expect(membershipMonth({ type: "guest", status: null, expiryMs: null }, start)).toEqual({ startDate: "2026-01-31", expiryDate: "2026-02-28", months: 1 });
  const paidUntil = at("2026-02-09T16:00:00Z");
  expect(membershipMonth({ type: "member", status: "active", expiryMs: paidUntil }, start)).toEqual({ startDate: "2026-02-10", expiryDate: "2026-03-10", months: 1 });
  expect(membershipMonth({ type: "member", status: "expired", expiryMs: at("2026-01-01T00:00:00Z") }, start).startDate).toBe("2026-01-31");
});

it("derives used-up and expired from the stored record", () => {
  const record = { status: "active" as const, sessions: 4, topUpSessions: 0, sessionsUsed: 1, coachingExpiresAt: at("2026-11-25T16:00:00Z") };
  expect(packageState(record, at("2026-11-20T00:00:00Z"))).toEqual({ status: "active", sessionsLeft: 3 });
  expect(packageState({ ...record, sessionsUsed: 4 }, at("2026-11-20T00:00:00Z"))).toEqual({ status: "used_up", sessionsLeft: 0 });
  // Unused sessions expire with the coaching validity.
  expect(packageState(record, at("2026-11-25T16:00:00Z"))).toEqual({ status: "expired", sessionsLeft: 0 });
  expect(packageState({ ...record, status: "approved" }, at("2026-11-20T00:00:00Z"))).toEqual({ status: "approved", sessionsLeft: 3 });
});
