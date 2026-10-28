import { Timestamp } from "firebase/firestore";
import { GYM_TIME_ZONE } from "@/lib/dates";

/** Calendar dates for renewals always follow the gym, not the staff device. */
export function renewalDateValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GYM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Clamp month ends: January 31 + one month becomes February 28/29. */
export function extendRenewalDate(start: string, months: number): string {
  const date = calendarDate(start);
  if (!date || !Number.isInteger(months) || months < 1 || months > 120) return "";
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/** Expiry keeps the existing exclusive-midnight convention, in the gym zone. */
export function renewalExpiryTimestamp(value: string): Timestamp | null {
  const date = calendarDate(value);
  if (!date) return null;
  const target = date.getTime();
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: GYM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const number = (name: string) => Number(parts.find((p) => p.type === name)!.value);
    const represented = Date.UTC(number("year"), number("month") - 1, number("day"), number("hour"), number("minute"), number("second"));
    const difference = target - represented;
    instant += difference;
    if (!difference) return Timestamp.fromMillis(instant);
  }
  return null;
}

export function renewalStartDate(expiry: Timestamp | null, now = new Date()): string {
  return renewalDateValue(expiry && expiry.toMillis() > now.getTime() ? expiry.toDate() : now);
}
