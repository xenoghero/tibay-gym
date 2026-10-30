import { expect, it } from "vitest";
import { voucherFixture } from "@/tests/voucher-fixture";
import { discountQuote, normalizeVoucherCode, validateVoucher, voucherAvailability } from "./vouchers";
it("normalizes codes and rejects ambiguous malformed inputs", () => {
  expect(normalizeVoucherCode(" train10 ")).toBe("TRAIN10");
  for (const code of ["abc", "TRAIN_10", "TRAIN 10", 1234, "x".repeat(25)]) expect(() => normalizeVoucherCode(code)).toThrow("voucher-invalid");
});
it("calculates fixed and capped percentage amounts with whole-centavo rounding", () => {
  expect(discountQuote(voucherFixture(), 6999, "daily_session", "student", 2000)).toMatchObject({ baseAmountMinor: 6999, discountAmountMinor: 699, amountMinor: 6300 });
  expect(discountQuote(voucherFixture({ maxDiscountMinor: 500 }), 6999, "daily_session", "student", 2000).amountMinor).toBe(6499);
  expect(discountQuote(voucherFixture({ discountKind: "fixed", value: 1500 }), 6000, "daily_session", "student", 2000).amountMinor).toBe(4500);
});
it.each([
  [{ status: "paused" }, "voucher-unavailable"], [{ status: "archived" }, "voucher-unavailable"],
  [{ startsAt: 3000 }, "voucher-not-started"], [{ endsAt: 2000 }, "voucher-expired"],
  [{ categories: ["regular"] }, "voucher-scope"], [{ kinds: ["renewal"] }, "voucher-scope"],
  [{ minimumBaseMinor: 10000 }, "voucher-minimum"], [{ totalLimit: 1, heldCount: 1 }, "voucher-limit"],
  [{ discountKind: "fixed", value: 6000 }, "voucher-payable"], [{ value: 1 }, "voucher-no-discount"],
] as const)("rejects ineligible terms %j", (changes, code) => {
  expect(() => discountQuote(voucherFixture({ ...changes } as Parameters<typeof voucherFixture>[0]), 6000, "daily_session", "student", 2000)).toThrow(code);
});
it("respects inclusive start, exclusive end and reserved per-customer capacity", () => {
  expect(voucherAvailability(voucherFixture({ startsAt: 2000, endsAt: 3000 }), 2000)).toBe("available");
  expect(() => discountQuote(voucherFixture(), 6000, "daily_session", "student", 2000, 1)).toThrow("voucher-customer-limit");
});
it("validates complete admin configuration without accepting fractional caps or empty scopes", () => {
  const input = voucherFixture();
  expect(validateVoucher({ ...input }).value).toBe(1000);
  for (const extra of [{ kinds: [] }, { categories: [] }, { value: 10001 }, { totalLimit: 1.5 }, { endsAt: 1000, startsAt: 2000 }, { discountKind: "other" }]) expect(() => validateVoucher({ ...input, ...extra })).toThrow("voucher-invalid-settings");
});
