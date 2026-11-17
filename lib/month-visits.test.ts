import { describe, expect, it } from "vitest";
import { addMonthVisit, countMonthVisits, visitsThisMonth } from "./month-visits";

// 2026-11-30T16:30Z is already 2026-12-01 00:30 in Manila.
const lateNov = Date.parse("2026-11-30T15:00:00Z"), earlyDec = Date.parse("2026-11-30T16:30:00Z");

describe("month visits", () => {
  it("counts within the Manila month and restarts when it changes", () => {
    const nov = addMonthVisit(addMonthVisit(undefined, lateNov), lateNov);
    expect(nov).toEqual({ month: "2026-11", count: 2 });
    expect(visitsThisMonth(nov, lateNov)).toBe(2);
    expect(visitsThisMonth(nov, earlyDec)).toBe(0);
    expect(addMonthVisit(nov, earlyDec)).toEqual({ month: "2026-12", count: 1 });
  });

  it("rebuilds from check-in times", () => {
    expect(countMonthVisits([lateNov, earlyDec, earlyDec], earlyDec)).toEqual({ month: "2026-12", count: 2 });
    expect(countMonthVisits([], lateNov)).toEqual({ month: "2026-11", count: 0 });
  });
});
