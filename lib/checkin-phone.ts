export const CHECKIN_PHONE_ERROR = "Enter an 11-digit phone number using digits only.";

export function isCheckinPhone(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{11}$/.test(value);
}
