import type { TimeSlot } from "./catalog";

/** A coach's booked Coaching session: one client for one hour (Asia/Manila), optionally one of a weekly series. */
export interface Booking { id: string; coachId: string; personId: string; date: string; hour: number; seriesId: string | null; createdAt: number; cancelledAt: number | null }

/** Bookable hours start 6 AM; the last starts 9 PM so it ends by the gym's 10 PM close. */
export const FIRST_HOUR = 6, LAST_HOUR = 21, MAX_REPEAT_WEEKS = 12;
/** The gym's three time slots as [first hour, end hour). */
export const SLOT_HOURS: Record<TimeSlot, [number, number]> = { morning: [6, 12], afternoon: [12, 18], evening: [18, 22] };
export const slotOf = (hour: number): TimeSlot => hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

/** The current hour in Manila, 0–23. */
export const manilaHour = (now: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" }).format(now));
/** True once a booking's hour has begun (date is a Manila YYYY-MM-DD; today is philippineDate(now)). */
export const hasStarted = (date: string, hour: number, today: string, hourNow: number) => date < today || (date === today && hour <= hourNow);

export const hourLabel = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
export const shortHour = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

/** Runs of free whole hours within [from, to): hours not booked and, today, not already started. */
export function freeRanges(from: number, to: number, taken: Set<number>, startedThrough: number) {
  const runs: [number, number][] = [];
  for (let hour = from; hour < to; hour++) {
    if (taken.has(hour) || hour <= startedThrough) continue;
    const last = runs.at(-1);
    if (last && last[1] === hour) last[1] = hour + 1; else runs.push([hour, hour + 1]);
  }
  return runs;
}
