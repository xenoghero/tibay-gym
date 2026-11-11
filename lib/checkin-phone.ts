export const CHECKIN_PHONE_ERROR = "Enter an 11-digit phone number using digits only.";

export const ACCOUNT_PHONE_ERROR = "Enter your 11-digit number, or the last 4 digits if you already have an account.";

/** Existing accounts may identify themselves by the last 4 digits; the server resolves them. */
export function isAccountPhone(value: unknown): value is string {
  return typeof value === "string" && /^([0-9]{4}|[0-9]{11})$/.test(value);
}

export function isCheckinPhone(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{11}$/.test(value);
}
