import type { TimeSlot } from "./catalog";

/** The gym's three time slots as [first hour, end hour), for matching a Preferred schedule. */
export const SLOT_HOURS: Record<TimeSlot, [number, number]> = { morning: [6, 12], afternoon: [12, 18], evening: [18, 22] };
export const slotOf = (start: number): TimeSlot => start < 12 * 60 ? "morning" : start < 18 * 60 ? "afternoon" : "evening";

/** Target muscles a Coaching session can focus on; a fixed list so cards and reports stay consistent. */
export const MUSCLES = ["Chest", "Back", "Shoulders", "Arms", "Core", "Legs", "Glutes", "Full body", "Cardio"] as const;
export type Muscle = typeof MUSCLES[number];
/** One set of an exercise: reps and weight are both optional. */
export interface WorkSet { reps: number | null; kg: number | null }
/** One line of a session's Exercise checklist. */
export interface Exercise { name: string; done: boolean; sets: WorkSet[] }

/**
 * A Coaching session on a date (Asia/Manila): one client with one coach, from `start` (minutes after midnight) for `minutes`.
 * Sessions saved before start/minutes existed have only a whole `hour` and last 60 minutes: read them through startOf/lengthOf.
 */
export interface Booking {
  id: string; coachId: string; personId: string; date: string; hour?: number; start?: number; minutes?: number;
  muscles?: Muscle[]; exercises?: Exercise[]; note?: string | null;
  seriesId: string | null; createdAt: number; cancelledAt: number | null;
}

/** Sessions start from 6 AM on the quarter hour and end by the gym's 10 PM close. */
export const DAY_START = 6 * 60, DAY_END = 22 * 60, STEP = 15, DURATIONS = [30, 45, 60, 90, 120] as const, MAX_REPEAT_WEEKS = 12;
export const MAX_EXERCISES = 100, MAX_SETS = 20;

export const startOf = (booking: Pick<Booking, "start" | "hour">) => booking.start ?? (booking.hour ?? 0) * 60;
export const lengthOf = (booking: Pick<Booking, "minutes">) => booking.minutes ?? 60;
export const endOf = (booking: Pick<Booking, "start" | "hour" | "minutes">) => startOf(booking) + lengthOf(booking);
/** Two sessions on the same day whose times overlap. */
export const overlaps = (a: { date: string; start: number; minutes: number }, b: { date: string; start: number; minutes: number }) =>
  a.date === b.date && a.start < b.start + b.minutes && b.start < a.start + a.minutes;

/** Minutes after midnight in Manila, 0–1439. */
export const manilaMinute = (now: number) => {
  const [hour, minute] = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "numeric", hourCycle: "h23" }).format(now).split(":").map(Number);
  return hour * 60 + minute;
};
/** True once a session's start time has come (date is a Manila YYYY-MM-DD; today is philippineDate(now)). */
export const hasStarted = (date: string, start: number, today: string, minuteNow: number) => date < today || (date === today && start <= minuteNow);

/** 450 → "7:30 AM" */
export const timeLabel = (minutes: number) => {
  const hour = Math.floor(minutes / 60), minute = minutes % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};
/** 420 → "7am", 570 → "9:30am" */
export const shortTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60), minute = minutes % 60;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "am" : "pm"}`;
};
/** Every allowed start time. */
export const START_TIMES = Array.from({ length: (DAY_END - DAY_START - 30) / STEP + 1 }, (_, i) => DAY_START + i * STEP);

/** A start and length the gym allows, or the error code that refuses it. */
export function timeError(start: unknown, minutes: unknown) {
  if (typeof start !== "number" || !Number.isInteger(start) || start < DAY_START || start % STEP) return "invalid-start";
  if (!DURATIONS.includes(minutes as typeof DURATIONS[number])) return "invalid-duration";
  if (start + (minutes as number) > DAY_END) return "after-closing";
  return null;
}

const number = (value: unknown, max: number, step: number) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || Math.round(value / step) * step !== value) throw new Error("invalid-set");
  return value;
};
/**
 * The session plan a coach or the admin may change at any time: target muscles, the Exercise checklist with sets, and the note.
 * Only fields present in `body` are returned. Throws an error code for anything outside the limits.
 */
export function readPlan(body: Record<string, unknown>) {
  const plan: { muscles?: Muscle[]; exercises?: Exercise[]; note?: string | null } = {};
  if (body.muscles !== undefined) {
    if (!Array.isArray(body.muscles) || body.muscles.some(item => !MUSCLES.includes(item))) throw new Error("invalid-muscles");
    plan.muscles = MUSCLES.filter(item => (body.muscles as unknown[]).includes(item));
  }
  if (body.exercises !== undefined) {
    if (!Array.isArray(body.exercises) || body.exercises.length > MAX_EXERCISES) throw new Error("invalid-exercises");
    plan.exercises = body.exercises.map(raw => {
      const item = (raw ?? {}) as Record<string, unknown>, name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name || name.length > 80 || typeof item.done !== "boolean" || !Array.isArray(item.sets) || item.sets.length > MAX_SETS) throw new Error("invalid-exercises");
      return { name, done: item.done, sets: item.sets.map(set => {
        const row = (set ?? {}) as Record<string, unknown>;
        return { reps: number(row.reps, 1000, 1), kg: number(row.kg, 1000, 0.25) };
      }) };
    });
  }
  if (body.note !== undefined) {
    if (body.note !== null && (typeof body.note !== "string" || body.note.length > 500)) throw new Error("invalid-note");
    plan.note = typeof body.note === "string" ? body.note.trim() || null : null;
  }
  return plan;
}
