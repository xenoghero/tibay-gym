import { Timestamp } from "firebase/firestore";

/**
 * The gym's calendar is fixed to Taipei unless deployment overrides it. Age
 * and other calendar-only decisions must use this zone rather than the
 * browser/server machine's potentially different local zone.
 */
export const GYM_TIME_ZONE =
  process.env.NEXT_PUBLIC_GYM_TIME_ZONE ?? "Asia/Taipei";

// Bridges between Firestore `Timestamp`s and the `<input type="date">` value
// format ("YYYY-MM-DD"). Dates that carry no time-of-day meaning (membership
// expiry, join date) are anchored to local midnight so they render as the same
// calendar day the admin typed, regardless of time zone.

/** `Timestamp` → "YYYY-MM-DD" in local time. Empty string for `null`. */
export function toDateInputValue(ts: Timestamp | null): string {
  if (!ts) return "";
  const d = ts.toDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" → `Timestamp` at local midnight. `null` for an empty/invalid value. */
export function fromDateInputValue(value: string): Timestamp | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

/** Today as a "YYYY-MM-DD" local-time string, for form defaults. */
export function todayDateInputValue(): string {
  return toDateInputValue(Timestamp.now());
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

function calendarDateParts(
  date: Date,
  timeZone: string = GYM_TIME_ZONE,
): CalendarDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year") ?? Number.NaN,
    month: values.get("month") ?? Number.NaN,
    day: values.get("day") ?? Number.NaN,
  };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Derives a person's current age from their birth date at render time. The
 * comparison uses the gym's local calendar, so a birthday changes at gym
 * midnight even if the admin's device is in another time zone. For a Feb 29
 * birthday, Feb 28 is treated as the birthday in non-leap years.
 *
 * `now` and `timeZone` are injectable so boundary behavior can be verified
 * without persisting or mocking an age field.
 */
export function getAgeFromBirthDate(
  birthDate: Timestamp | null,
  now: Date = new Date(),
  timeZone: string = GYM_TIME_ZONE,
): number | null {
  if (!birthDate) return null;

  const birth = calendarDateParts(birthDate.toDate(), timeZone);
  const today = calendarDateParts(now, timeZone);
  if (
    !Number.isFinite(birth.year) ||
    !Number.isFinite(birth.month) ||
    !Number.isFinite(birth.day) ||
    !Number.isFinite(today.year) ||
    !Number.isFinite(today.month) ||
    !Number.isFinite(today.day)
  ) {
    return null;
  }

  const birthDay =
    birth.month === 2 && birth.day === 29 && !isLeapYear(today.year)
      ? 28
      : birth.day;
  let age = today.year - birth.year;
  if (
    today.month < birth.month ||
    (today.month === birth.month && today.day < birthDay)
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * `Timestamp` → human date without time-of-day, gym-local ("Aug 29, 2026").
 * For values where the time isn't meaningful (membership expiry, join date).
 * `"—"` for `null`.
 */
export function formatLongDate(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * `Timestamp` → clock time only, gym-local ("6:42 PM"). Used where the date is
 * already implied by context (e.g. the Overview activity feed, which only ever
 * shows today's check-ins). `"—"` for `null` (an unresolved `serverTimestamp()`).
 */
export function formatClockTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * `Timestamp` → full date + time, gym-local ("Aug 29, 2026, 6:42 PM"). The
 * `admin-dashboard-content.md` §0 format for log-style values where both the day
 * and the time matter (created/updated timestamps). `"—"` for `null`.
 */
export function formatDateTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * `Timestamp` → date + time without the year, gym-local ("Aug 29, 5:04 PM").
 * Used for the People list "last visit" column and the Person Profile visit
 * history, where rows are recent and the year is just noise. `"—"` for `null`.
 */
export function formatShortDateTime(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Statistics tab date ranges (TASKLIST Phase 10) -------------------------
// The tab's query-on-demand model (statistics-tab-content.md §"Decisions
// locked") needs a `[start, end)` local-time window per preset/custom range,
// plus display/filename formatting for that same window.

/** Local midnight for the given date (defaults to now). */
export function startOfLocalDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `date` shifted by `days` (may be negative), preserving time-of-day. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** An inclusive-start, exclusive-end local-time window as Firestore `Timestamp`s. */
export interface DateRange {
  start: Timestamp;
  /** Exclusive upper bound — local midnight the day *after* the range ends. */
  end: Timestamp;
}

export type RangePreset = "today" | "7d" | "30d" | "month";

/** Builds the `[start, end)` window for one of the tab's preset buttons. */
export function rangeForPreset(preset: RangePreset, now: Date = new Date()): DateRange {
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  switch (preset) {
    case "today":
      return { start: Timestamp.fromDate(todayStart), end: Timestamp.fromDate(tomorrowStart) };
    case "7d":
      return {
        start: Timestamp.fromDate(addDays(todayStart, -6)),
        end: Timestamp.fromDate(tomorrowStart),
      };
    case "30d":
      return {
        start: Timestamp.fromDate(addDays(todayStart, -29)),
        end: Timestamp.fromDate(tomorrowStart),
      };
    case "month": {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: Timestamp.fromDate(monthStart),
        end: Timestamp.fromDate(tomorrowStart),
      };
    }
  }
}

/** Builds the `[start, end)` window for a custom start/end date-input pair (end inclusive). */
export function rangeForCustom(startValue: string, endValue: string): DateRange | null {
  const start = fromDateInputValue(startValue);
  const endDay = fromDateInputValue(endValue);
  if (!start || !endDay) return null;
  return { start, end: Timestamp.fromDate(addDays(endDay.toDate(), 1)) };
}

/** `true` if a range spans a single calendar day (drives the single-day-total display rule). */
export function isSingleDayRange(range: DateRange): boolean {
  return range.end.toMillis() - range.start.toMillis() <= 24 * 60 * 60 * 1000;
}

/** Human range label for tab headings ("Aug 23 – Aug 29, 2026", or one date for a single day). */
export function formatRangeLabel(range: DateRange): string {
  const startDate = range.start.toDate();
  const lastDay = new Date(range.end.toDate().getTime() - 1);
  if (isSingleDayRange(range)) return formatLongDate(range.start);
  const sameYear = startDate.getFullYear() === lastDay.getFullYear();
  const startLabel = startDate.toLocaleDateString(
    "en-US",
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );
  const endLabel = lastDay.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

/** "YYYY-MM-DD" for filenames, from a range boundary date. */
function fileDateStamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Filename-safe range fragment ("2026-08-23_to_2026-08-29"), for the CSV export. */
export function rangeFilenameStamp(range: DateRange): string {
  const lastDay = new Date(range.end.toDate().getTime() - 1);
  return `${fileDateStamp(range.start.toDate())}_to_${fileDateStamp(lastDay)}`;
}
