import { DEFAULT_SMS_SETTINGS, type SmsContact, type SmsSettings } from "./contracts";
export function smsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = value.replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(phone)) return `+63${phone.slice(1)}`;
  if (/^639\d{9}$/.test(phone)) return `+${phone}`;
  return /^\+639\d{9}$/.test(phone) ? phone : null;
}
export function smsText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 480 || /[\x00-\x08\x0b-\x1f]/.test(value)) throw new Error("invalid-sms-text");
  return value.trim();
}
export function validateSmsSettings(input: Record<string, unknown>): SmsSettings {
  if (typeof input.enabled !== "boolean" || typeof input.policyConfirmed !== "boolean" ||
      typeof input.sendTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sendTime) ||
      !Number.isInteger(input.maxAttempts) || Number(input.maxAttempts) < 1 || Number(input.maxAttempts) > 3 ||
      !Number.isInteger(input.revision) || Number(input.revision) < 0) throw new Error("invalid-sms-settings");
  const expiryTemplate = smsText(input.expiryTemplate), inactivityTemplate = smsText(input.inactivityTemplate);
  if (/\{[^}]+\}/.test(inactivityTemplate)) throw new Error("invalid-template-token");
  if ((expiryTemplate + inactivityTemplate).match(/\{[^}]+\}/g)?.some(token => !["{expiry}", "{days}"].includes(token))) throw new Error("invalid-template-token");
  if (input.enabled && !input.policyConfirmed) throw new Error("sms-policy-required");
  return { ...DEFAULT_SMS_SETTINGS, enabled: input.enabled, policyConfirmed: input.policyConfirmed,
    sendTime: input.sendTime, maxAttempts: Number(input.maxAttempts), revision: Number(input.revision), expiryTemplate, inactivityTemplate };
}
export function eligibleContact(person: Record<string, unknown> | undefined, contact: SmsContact | undefined): string | null {
  const phone = smsPhone(person?.phone);
  return person && !person.deletingAt && contact?.permission === true && contact.optedOut === false && phone === contact.phone ? phone : null;
}
