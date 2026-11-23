"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { addManilaDays } from "@/lib/coaching/clocks";
import { hasStarted, shortTime, type Exercise, type Muscle } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import { BrandLoading } from "@/components/ui/brand-loading";
import { coachFetch, type CoachClient } from "./coach-clients";
import { AddSheet, DaySheet, SessionSheet } from "./booking-sheet";
import s from "./schedule.module.css";

export interface ScheduleMark { id: string; outcome: "done" | "no_show"; coachId: string; createdAt: number }
export interface ScheduleBooking {
  id: string; coachId: string; personId: string; date: string; start: number; minutes: number; seriesId: string | null;
  muscles: Muscle[]; exercises: Exercise[]; note: string | null; mark: ScheduleMark | null;
}
/** Admin rows also carry the client's coach (null when unassigned). */
export type ScheduleClient = CoachClient & { booked: number; next: { date: string; start: number; coachId: string } | null; coachId?: string | null; coachName?: string | null };
export interface ScheduleData {
  today: string; minuteNow: number; bookings: ScheduleBooking[]; clients: ScheduleClient[];
  /** Admin only: the active coaches. */
  coaches?: { id: string; name: string }[];
}
export type BookingState = "done" | "no_show" | "due" | "live" | "unmarked" | "booked";
export type Sheet = { kind: "day"; date: string } | { kind: "session"; id: string } | { kind: "add"; date: string; personId?: string; coachId?: string } | null;

export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const dayKey = (date: string) => (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[weekday(date)];
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", ...options });
export const firstOfMonth = (date: string, shift = 0) => {
  const [year, month] = date.split("-").map(Number), at = new Date(Date.UTC(year, month - 1 + shift, 1));
  return at.toISOString().slice(0, 10);
};
/** Every day of the month of `date`, in order. */
export const monthDays = (date: string) => {
  const days = [], end = firstOfMonth(date, 1);
  for (let day = firstOfMonth(date); day < end; day = addManilaDays(day, 1)) days.push(day);
  return days;
};
export const firstName = (name: string) => name.split(/\s+/)[0];
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
/** Each coach's colour on badges, by their order in the coach list (told apart by their initial too). */
const COLORS = ["#8ab4ff", "#f2a65a", "#c4a7ff", "#7fd4c9", "#ff9db5", "#d9d36a"];

/** Coaches mark at most 30 days back; older sessions go to the admin. */
export function bookingState(booking: ScheduleBooking, today: string, minuteNow: number, admin = false): BookingState {
  if (booking.mark) return booking.mark.outcome;
  if (!hasStarted(booking.date, booking.start, today, minuteNow)) return "booked";
  if (!admin && booking.date < addManilaDays(today, -30)) return "unmarked";
  return booking.date === today && minuteNow < booking.start + booking.minutes ? "live" : "due";
}
export const canMark = (state: BookingState) => state === "due" || state === "live";
export const bookableClient = (client: ScheduleClient) => !client.frozen && (client.status === "approved" || client.status === "active") && client.sessionsLeft > 0;
export const muscleText = (muscles: string[]) => muscles.join(", ");

export const MESSAGES: Record<string, string> = {
  "time-taken": "The coach already has a session at that time.", "client-time-taken": "The client already has a session at that time.",
  "invalid-start": "Choose a start time on the quarter hour, from 6:00 AM.", "invalid-duration": "Choose a length of 30, 45, 60, 90 or 120 minutes.",
  "after-closing": "Sessions must end by 10:00 PM.", "too-far-ahead": "That is too far ahead. Add it closer to the date.",
  "not-enough-sessions": "This client doesn’t have enough sessions left for that many.", "after-coaching-expiry": "That date is after the client’s coaching ends.",
  "no-sessions-left": "This client has no sessions left.", "coaching-expired": "This client's coaching validity has ended.", "client-frozen": "This client's package is frozen.",
  "client-not-assigned": "This client is no longer assigned to you.", "booking-marked": "This session is already marked. Undo the mark to change its time.",
  "booking-not-started": "You can mark this session once it starts.", "booking-unavailable": "This session no longer exists. Refresh and try again.",
  "invalid-session-date": "Sessions older than 30 days can only be changed by the admin.", "mark-undo-closed": "Marks can only be undone on the day you made them. Ask the admin.",
  "client-has-other-coach": "This client already has another coach. Switch coaches under Clients first.", "coach-unavailable": "That coach is no longer active.",
  "coaching-client-required": "This client has no coaching package to book from.", "invalid-set": "Reps and kg must be numbers from 0 to 1000.",
  "invalid-exercises": "Each exercise needs a name of up to 80 characters.", "invalid-note": "Keep the note under 500 characters.", "body-too-large": "That checklist is too long to save.",
};
export const message = (code: string | undefined) => (code && MESSAGES[code]) ?? "Could not save. Check your connection and try again.";

/** The Schedule's data for one month (plus the week after, so "next 7 days" checks work at month end), and a POST helper that reloads it. */
export function useSchedule(user: User | null, api: string, month: string) {
  const [data, setData] = useState<ScheduleData | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState("");
  const to = addManilaDays(firstOfMonth(month, 1), 6);
  useEffect(() => {
    if (!user) return;
    let active = true;
    coachFetch(user, `${api}?from=${month}&to=${to}`).then(async response => {
      if (!response.ok) throw new Error();
      const next: ScheduleData = await response.json();
      if (active) { setData(next); setError(""); }
    }).catch(() => { if (active) setError("Could not load the schedule. Try again."); });
    return () => { active = false; };
  }, [user, api, month, to, reload]);
  async function send(path: string, body: Record<string, unknown>, done: string) {
    if (busy || !user) return null;
    setBusy(true); setActionError(""); setNotice("");
    try {
      const response = await coachFetch(user, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(message(result.error));
      setNotice(done); setReload(v => v + 1);
      return result as Record<string, unknown>;
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not save."); return null; }
    finally { setBusy(false); }
  }
  return { data, error, busy, notice, actionError, send, retry: () => setReload(v => v + 1), clear: () => { setActionError(""); setNotice(""); } };
}

/**
 * The Schedule: a month picker over one card per day (2 across on phones, 3 on tablets, 4 on desktops).
 * A day opens its sessions; a session opens its plan, checklist and marks. The admin also sees every coach, with a coach filter.
 */
export function Schedule({ user, admin = false, initial = null, toolbar }: { user: User; admin?: boolean; initial?: Sheet; toolbar?: ReactNode }) {
  const api = admin ? "/api/admin/coach-bookings" : "/api/coach/bookings";
  const [month, setMonth] = useState(() => firstOfMonth(philippineDate(Date.now()))), [coach, setCoach] = useState("");
  const [sheet, setSheet] = useState<Sheet>(initial);
  const schedule = useSchedule(user, api, month), { data, busy, notice, actionError, send } = schedule;
  const todayCard = useRef<HTMLButtonElement>(null), scrolled = useRef(false);
  useEffect(() => {
    if (data && !scrolled.current && todayCard.current) { scrolled.current = true; todayCard.current.scrollIntoView?.({ block: "center" }); }
  }, [data]);

  if (!data) return <main className={s.page}>{toolbar}{schedule.error
    ? <><p className={s.error} role="alert">{schedule.error}</p><button type="button" className={s.button} style={{ alignSelf: "flex-start" }} onClick={schedule.retry}>Retry</button></>
    : <div className={s.loading}><BrandLoading label="Loading the schedule" /></div>}</main>;

  const { today, minuteNow } = data, coaches = data.coaches ?? [];
  const colors = new Map(coaches.map((row, index) => [row.id, COLORS[index % COLORS.length]]));
  const coachName = (id: string | null | undefined) => coaches.find(row => row.id === id)?.name ?? "Former coach";
  const badge = (id: string) => ({ background: colors.get(id) ?? "var(--rs-muted)" });
  const clients = new Map(data.clients.map(client => [client.id, client]));
  const nameOf = (id: string) => clients.get(id)?.name ?? "Former client";
  const shown = coach ? data.bookings.filter(row => row.coachId === coach) : data.bookings;
  const byDate = new Map<string, ScheduleBooking[]>();
  for (const row of [...shown].sort((a, b) => a.start - b.start)) byDate.set(row.date, [...byDate.get(row.date) ?? [], row]);
  const state = (row: ScheduleBooking) => bookingState(row, today, minuteNow, admin);
  const inMonth = shown.filter(row => row.date.startsWith(month.slice(0, 7)));
  const counts = { upcoming: inMonth.filter(row => state(row) === "booked").length, due: shown.filter(row => canMark(state(row))).length,
    done: inMonth.filter(row => row.mark?.outcome === "done").length };
  const open = (next: Sheet) => { schedule.clear(); setSheet(next); };
  const session = sheet?.kind === "session" ? data.bookings.find(row => row.id === sheet.id) : undefined;
  const sheetProps = { data, admin, busy, error: actionError, nameOf, coachName, badge, state, onClose: () => setSheet(null) };

  return <main className={s.page}>
    {toolbar ?? <header className={s.head}>
      <div className={s.kicker}>{dateLabel(today, { weekday: "long", month: "short", day: "numeric" }).toUpperCase()}</div>
      <h1 className={s.title}>Schedule</h1>
    </header>}
    <div className={s.monthBar}>
      <button type="button" className={s.iconButton} aria-label="Previous month" onClick={() => setMonth(firstOfMonth(month, -1))}>‹</button>
      <span className={s.monthLabel} aria-live="polite">{dateLabel(month, { month: "long", year: "numeric" })}</span>
      <button type="button" className={s.iconButton} aria-label="Next month" onClick={() => setMonth(firstOfMonth(month, 1))}>›</button>
    </div>
    <div className={s.toolsRow}>
      <p className={s.counts}><span><strong>{counts.upcoming}</strong> upcoming</span><span data-tone="accent"><strong>{counts.due}</strong> to mark</span><span data-tone="success"><strong>{counts.done}</strong> done</span></p>
      {month !== firstOfMonth(today) && <button type="button" className={s.button} onClick={() => setMonth(firstOfMonth(today))}>Today</button>}
      {admin && <button type="button" className={`${s.button} ${s.primary}`} onClick={() => open({ kind: "add", date: month === firstOfMonth(today) ? today : month, coachId: coach || undefined })}>+ Add session</button>}
    </div>
    {admin && <div role="group" aria-label="Filter by coach" className={s.chips}>
      <button type="button" className={s.chip} aria-pressed={!coach} onClick={() => setCoach("")}>All coaches</button>
      {coaches.map(row => <button key={row.id} type="button" className={s.chip} aria-pressed={coach === row.id} onClick={() => setCoach(row.id)}>
        <span className={s.badge} style={badge(row.id)} aria-hidden="true">{initials(row.name)[0]}</span>{row.name}</button>)}
    </div>}
    {notice && !sheet && <p className={s.notice} role="status">{notice}</p>}
    {actionError && !sheet && <p className={s.error} role="alert">{actionError}</p>}

    <div className={s.grid}>
      {monthDays(month).map(date => {
        const list = byDate.get(date) ?? [], past = date < today, due = list.filter(row => canMark(state(row))).length;
        const done = list.filter(row => row.mark?.outcome === "done").length, missed = list.filter(row => row.mark?.outcome === "no_show").length;
        const summary = past && list.length && !due ? [done && `✓ ${done} done`, missed && `${missed} no-show`, list.length - done - missed && `${list.length - done - missed} not marked`].filter(Boolean).join(" · ") : "";
        return <button key={date} ref={date === today ? todayCard : undefined} type="button" className={s.tile} data-today={date === today || undefined} data-past={past || undefined}
          aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} session${list.length === 1 ? "" : "s"}${due ? `, ${due} to mark` : ""}`}
          onClick={() => open({ kind: "day", date })}>
          <span className={s.tileHead}><span className={s.dayNum}>{Number(date.slice(8))}</span><span className={s.weekday}>{dateLabel(date, { weekday: "short" }).toUpperCase()}</span></span>
          {summary ? <span className={s.summary} data-tone={done ? "success" : undefined}>{summary}</span>
            : !list.length ? <span className={s.summary}>{past ? "No sessions" : <>No sessions<span className={s.addHint}>+ Add session</span></>}</span>
            : <span className={s.lines}>{list.slice(0, 3).map(row => <span key={row.id} className={s.line} data-state={state(row)}>
                <time>{shortTime(row.start)}</time><span>{firstName(nameOf(row.personId))}{row.muscles.length ? ` · ${row.muscles[0]}` : ""}</span>
                {admin && <span className={s.badge} style={badge(row.coachId)} aria-hidden="true">{initials(coachName(row.coachId))[0]}</span>}
              </span>)}</span>}
          {(list.length > 3 && !summary) || due ? <span className={s.tileFoot}>
            <span>{list.length > 3 && !summary ? `+${list.length - 3} more` : ""}</span>{due ? <span className={s.dueBadge}>{due} to mark</span> : null}
          </span> : null}
        </button>;
      })}
    </div>

    {sheet?.kind === "day" && <DaySheet {...sheetProps} date={sheet.date} list={byDate.get(sheet.date) ?? []}
      onOpen={id => open({ kind: "session", id })} onAdd={() => open({ kind: "add", date: sheet.date, coachId: coach || undefined })} />}
    {session && <SessionSheet key={session.id} {...sheetProps} booking={session} siblings={byDate.get(session.date) ?? [session]}
      onOpen={id => open({ kind: "session", id })} onBack={() => open({ kind: "day", date: session.date })}
      onSend={(body, done) => send(api, body, done)} onMark={(body, done) => send(admin ? api : "/api/coach/sessions", body, done)}
      onFix={(body, done) => send("/api/admin/coaching-sessions", body, done)} />}
    {sheet?.kind === "add" && <AddSheet {...sheetProps} date={sheet.date} personId={sheet.personId} coachId={sheet.coachId} onBack={() => open({ kind: "day", date: sheet.date })}
      onAdd={async (body, done) => { if (await send(api, { action: "book", ...body }, done)) setSheet({ kind: "day", date: body.date }); }} />}
  </main>;
}
