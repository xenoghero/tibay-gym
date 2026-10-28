import { expect, it } from "vitest";
import { membershipCoverage, coverageExpiryMs } from "./coverage";
it("clamps calendar month ends and preserves exclusive Philippine-midnight expiry", () => {
  const coverage = membershipCoverage({ type: "member", status: "active", expiryMs: Date.parse("2028-01-30T16:00:00Z") }, Date.parse("2028-01-01T00:00:00Z"));
  expect(coverage).toEqual({ startDate: "2028-01-31", expiryDate: "2028-02-29", months: 1 });
  expect(coverageExpiryMs(coverage)).toBe(Date.parse("2028-02-28T16:00:00Z"));
});
