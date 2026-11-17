import { philippineDate } from "@/lib/finance/rules";

/** Check-ins in one gym calendar month ("YYYY-MM", Manila), stored on the person by the server. */
export type MonthVisits = { month: string; count: number };

export const visitMonth = (at: number) => philippineDate(at).slice(0, 7);

/** The stored count when it is for this month; an older month means no visits yet this month. */
export function visitsThisMonth(stored: MonthVisits | null | undefined, now = Date.now()): number {
  return stored?.month === visitMonth(now) ? stored.count : 0;
}

/** The counter after one more check-in at `at`. */
export function addMonthVisit(stored: MonthVisits | null | undefined, at: number): MonthVisits {
  return { month: visitMonth(at), count: visitsThisMonth(stored, at) + 1 };
}

/** The counter rebuilt from every check-in time, for repairs and moved visits. */
export function countMonthVisits(checkInsMs: number[], now = Date.now()): MonthVisits {
  const month = visitMonth(now);
  return { month, count: checkInsMs.filter(at => visitMonth(at) === month).length };
}
