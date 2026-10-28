import { expect, it } from "vitest";
import { eligibleContact, smsPhone, validateSmsSettings } from "./rules";
import { DEFAULT_SMS_SETTINGS } from "./contracts";
it("normalizes Philippine mobile numbers without accepting arbitrary destinations", () => {
  expect(smsPhone("0917 123 4567")).toBe("+639171234567"); expect(smsPhone("+639171234567")).toBe("+639171234567");
  expect(smsPhone("1234")).toBeNull(); expect(smsPhone("+12025550100")).toBeNull();
});
it("does not infer permission for existing customers or changed numbers", () => {
  expect(eligibleContact({ phone: "09171234567" }, undefined)).toBeNull();
  expect(eligibleContact({ phone: "09171234567" }, { phone: "+639179999999", permission: true, optedOut: false, revision: 1, updatedAt: 1 })).toBeNull();
});
it("validates activation policy, time, templates and retry bounds", () => {
  expect(() => validateSmsSettings({ ...DEFAULT_SMS_SETTINGS, enabled: true })).toThrow();
  expect(() => validateSmsSettings({ ...DEFAULT_SMS_SETTINGS, sendTime: "25:00" })).toThrow();
  expect(() => validateSmsSettings({ ...DEFAULT_SMS_SETTINGS, maxAttempts: 4 })).toThrow();
  expect(() => validateSmsSettings({ ...DEFAULT_SMS_SETTINGS, expiryTemplate: "Unknown {secret}" })).toThrow();
});
