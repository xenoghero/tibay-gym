import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { extendRenewalDate, renewalDateValue, renewalExpiryTimestamp, renewalStartDate } from "./membership-renewal";

describe("renewal calendar", () => {
  it("preserves remaining time and starts lapsed memberships on the gym's today", () => {
    const now = new Date("2026-10-12T18:00:00Z");
    expect(renewalStartDate(Timestamp.fromDate(new Date("2026-11-01T16:00:00Z")), now)).toBe("2026-11-02");
    expect(renewalStartDate(Timestamp.fromDate(now), now)).toBe("2026-10-13");
    expect(renewalStartDate(null, now)).toBe("2026-10-13");
  });
  it("clamps month ends and handles leap years and year rollover", () => {
    expect(extendRenewalDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(extendRenewalDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(extendRenewalDate("2028-02-29", 12)).toBe("2029-02-28");
    expect(extendRenewalDate("2026-12-31", 3)).toBe("2027-03-31");
  });
  it("anchors expiry in the gym zone and rejects invalid dates", () => {
    expect(renewalExpiryTimestamp("2026-11-12")?.toDate().toISOString()).toBe("2026-11-11T16:00:00.000Z");
    expect(renewalDateValue(renewalExpiryTimestamp("2026-11-12")!.toDate())).toBe("2026-11-12");
    for (const date of ["2026-02-30", "2026-13-01", "", "garbage"]) {
      expect(renewalExpiryTimestamp(date)).toBeNull();
      expect(extendRenewalDate(date, 1)).toBe("");
    }
  });
});
