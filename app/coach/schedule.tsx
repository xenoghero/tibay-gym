"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { addManilaDays } from "@/lib/coaching/clocks";
import { FIRST_HOUR, LAST_HOUR, SLOT_HOURS, freeRanges, hasStarted, hourLabel, shortHour, slotOf } from "@/lib/coaching/bookings";
import type { TimeSlot } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import { BrandLoading } from "@/components/ui/brand-loading";
import { coachFetch, type CoachClient } from "./coach-clients";
import { BookingDetail, BookingSheet } from "./booking-sheet";
import s from "./schedule.module.css";

/** Admin rows also carry the client's coach (null when unassigned). */
export type ScheduleClient = CoachClient & { booked: number; needsBooking: boolean; coachId?: string | null; coachName?: string | null };
export interface ScheduleBooking { id: string; coachId: string; personId: string; date: string; hour: number; seriesId: string | null; mark: { id: string; outcome: "done" | "no_show" } | null }
export interface ScheduleData {
  today: string; hourNow: number; bookings: ScheduleBooking[]; marks: { date: string; outcome: "done" | "no_show"; coachId: string }[]; clients: ScheduleClient[];
  /** Admin only: the active coaches. */
  coaches?: { id: string; name: string }[];
}
export type BookingState = "done" | "no_show" | "due" | "live" | "unmarked" | "booked";

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];
export const SLOT_NAMES: Record<TimeSlot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
export const SLOT_RANGES: Record<TimeSlot, string> = { morning: "6 AM–12 PM", afternoon: "12–6 PM", evening: "6–10 PM" };
const HOUR_PX = 36, HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const dayKey = (date: string) => DAY_KEYS[weekday(date)];
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", ...options });
export const weekStart = (date: string) => addManilaDays(date, -weekday(date));
export const firstOfMonth = (date: string, shift = 0) => {
  const [year, month] = date.split("-").map(Number), at = new Date(Date.UTC(year, month - 1 + shift, 1));
  return at.toISOString().slice(0, 10);
};
/** Whole weeks (Sunday first) covering the month of `date`. */
export function monthDays(date: string) {
  const start = weekStart(firstOfMonth(date)), end = addManilaDays(weekStart(addManilaDays(firstOfMonth(date, 1), -1)), 6), days = [];
  for (let day = start; day <= end; day = addManilaDays(day, 1)) days.push(day);
  return days;
}
export const span = (from: string, to: string) => from.slice(5, 7) === to.slice(5, 7)
  ? `${dateLabel(from, { month: "short", day: "numeric" })}–${dateLabel(to, { day: "numeric" })}`
  : `${dateLabel(from, { month: "short", day: "numeric" })}–${dateLabel(to, { month: "short", day: "numeric" })}`;
export const h12 = (hour: number) => hour % 12 || 12;

export function bookingState(booking: ScheduleBooking, today: string, hourNow: number): BookingState {
  if (booking.mark) return booking.mark.outcome;
  if (!hasStarted(booking.date, booking.hour, today, hourNow)) return "booked";
  // Coaches may mark at most 30 days back; older ones go to the admin.
  if (booking.date < addManilaDays(today, -30)) return "unmarked";
  return booking.date === today && booking.hour === hourNow ? "live" : "due";
}
export const canMark = (state: BookingState) => state === "due" || state === "live";
export const bookableClient = (client: ScheduleClient) => !client.frozen && (client.status === "approved" || client.status === "active") && client.sessionsLeft > 0;
export const preferenceText = (client: CoachClient) => {
  const pref = client.preferredSchedule;
  if (!pref) return "No preferred schedule";
  return `Prefers ${pref.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(", ")} · ${SLOT_NAMES[pref.timeSlot].toLowerCase()}s`;
};
export const firstName = (name: string) => name.split(/\s+/)[0];

/** Agenda line under a booked client's name, with its tone. */
function bookingMeta(booking: ScheduleBooking, state: BookingState, client: ScheduleClient | undefined, today: string): [string, string | undefined] {
  if (state === "done") return ["✓ Done", "success"];
  if (state === "no_show") return ["No-show", undefined];
  if (state === "unmarked") return ["Not marked", undefined];
  if (state === "live") return ["In session now · mark when done", "accent"];
  if (state === "due") return [booking.date === today ? `Ended ${hourLabel(booking.hour + 1)} · not marked yet` : "Not marked yet", "accent"];
  if (client?.sessionsLeft === 1) return ["Last session · remind to renew", "accent"];
  return [client ? `${client.sessionsLeft} left` : "", undefined];
}

export const MESSAGES: Record<string, string> = {
  "time-taken": "You already have a session at that hour.", "booking-in-past": "That hour has already started. Pick a later one.",
  "not-enough-sessions": "This client doesn’t have enough sessions left for that many bookings.", "after-coaching-expiry": "That date is after the client’s coaching ends.",
  "no-sessions-left": "This client has no sessions left.", "coaching-expired": "This client's coaching validity has ended.", "client-frozen": "This client's package is frozen.",
  "client-not-assigned": "This client is no longer assigned to you.", "booking-marked": "This session is already marked.", "booking-not-started": "You can mark this session once it starts.",
  "booking-unavailable": "This booking no longer exists. Refresh and try again.", "invalid-session-date": "Sessions older than 30 days can only be fixed by the admin.",
  "client-has-other-coach": "This client already has another coach. Switch coaches under Clients first.", "coach-unavailable": "That coach is no longer active.",
  "coaching-client-required": "This client has no coaching package to book from.",
};

type Sheet = { kind: "book"; date: string; hour: number | null; personId?: string } | { kind: "detail"; id: string } | null;

/** The coach's Schedule: week strip and time-slot agenda on phones, a week grid on desktops; month view on both. */
export function Schedule({ user }: { user: User }) {
  const api = "/api/coach/bookings";
  const [selected, setSelected] = useState(() => philippineDate(Date.now())), [view, setView] = useState<"week" | "month">("week");
  const [data, setData] = useState<ScheduleData | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState("");
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addManilaDays(weekStart(selected), i)), [selected]);
  const month = useMemo(() => monthDays(selected), [selected]);
  const from = month[0] < week[0] ? month[0] : week[0], to = month.at(-1)! > week[6] ? month.at(-1)! : week[6];
  useEffect(() => {
    let active = true;
    coachFetch(user, `${api}?from=${from}&to=${to}`).then(async response => {
      if (!response.ok) throw new Error();
      const next: ScheduleData = await response.json();
      if (active) { setData(next); setError(""); }
    }).catch(() => { if (active) setError("Could not load your schedule. Try again."); });
    return () => { active = false; };
  }, [user, from, to, reload]);

  async function send(path: string, body: Record<string, unknown>, done: string) {
    if (busy) return false;
    setBusy(true); setActionError(""); setNotice("");
    try {
      const response = await coachFetch(user, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(MESSAGES[(await response.json().catch(() => ({}))).error] ?? "Could not save. Check your connection and try again.");
      setNotice(done); setReload(v => v + 1);
      return true;
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not save."); return false; }
    finally { setBusy(false); }
  }
  const mark = (booking: ScheduleBooking, outcome: "done" | "no_show") => send("/api/coach/sessions",
    { action: "mark", personId: booking.personId, outcome, bookingId: booking.id, operationId: crypto.randomUUID() },
    outcome === "done" ? "Session marked done." : "No-show recorded. No session was used.");

  if (!data) return <main className={s.page}>{error
    ? <><p className={s.error} role="alert">{error}</p><button type="button" className={s.button} style={{ alignSelf: "flex-start" }} onClick={() => setReload(v => v + 1)}>Retry</button></>
    : <div className={s.loading}><BrandLoading label="Loading your schedule" /></div>}</main>;

  const { today, hourNow } = data, clients = new Map(data.clients.map(client => [client.id, client]));
  const nameOf = (id: string) => clients.get(id)?.name ?? "Former client";
  const shown = data.bookings, marks = data.marks;
  const byDate = new Map<string, ScheduleBooking[]>();
  for (const booking of [...shown].sort((a, b) => a.hour - b.hour)) byDate.set(booking.date, [...byDate.get(booking.date) ?? [], booking]);
  const startedThrough = (date: string) => date < today ? 99 : date === today ? hourNow : -1;
  const needs = data.clients.filter(client => client.needsBooking);
  const due = shown.filter(booking => canMark(bookingState(booking, today, hourNow))).sort((a, b) => b.date.localeCompare(a.date) || b.hour - a.hour);
  const detail = sheet?.kind === "detail" ? data.bookings.find(booking => booking.id === sheet.id) : undefined;
  const step = (direction: number) => setSelected(view === "week" ? addManilaDays(selected, 7 * direction) : firstOfMonth(selected, direction));
  const book = (date: string, hour: number | null, personId?: string) => { setNotice(""); setActionError(""); setSheet({ kind: "book", date: date < today ? today : date, hour, personId }); };

  const day = byDate.get(selected) ?? [], taken = new Set(day.map(booking => booking.hour));
  const nudge = selected < today ? undefined : needs.map(client => {
    const pref = client.preferredSchedule;
    if (!pref || !(pref.weekdays as string[]).includes(dayKey(selected)) || day.some(booking => booking.personId === client.id)) return null;
    const free = freeRanges(...SLOT_HOURS[pref.timeSlot], taken, startedThrough(selected))[0];
    return free ? { client, hour: free[0], slot: pref.timeSlot } : null;
  }).find(Boolean);

  const markButtons = (booking: ScheduleBooking) => <>
    <button type="button" className={`${s.button} ${s.primary}`} disabled={busy} onClick={() => void mark(booking, "done")}>✓ Mark done</button>
    <button type="button" className={s.button} disabled={busy} onClick={() => void mark(booking, "no_show")}>No-show</button>
  </>;
  const needsList = <section className={s.feed} aria-labelledby="needs-title">
    <div className={s.feedHead}><h2 id="needs-title">Needs a booking</h2><span>Nothing booked next 7 days</span></div>
    {needs.length ? needs.map(client => <div key={client.id} className={s.feedRow}>
      <span className={s.avatar} aria-hidden="true">{client.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
      <span className={s.who}><strong>{client.name}</strong><span>{preferenceText(client)} · {client.sessionsLeft} left</span></span>
      <button type="button" className={s.button} onClick={() => book(selected, null, client.id)}>Book</button>
    </div>) : <p className={s.feedNote}>Every client with sessions has one booked this week.</p>}
  </section>;

  return <main className={s.page}>
    <header className={s.head}>
      <div>
        <div className={s.kicker}>{view === "week" ? `Week of ${span(week[0], week[6])}` : dateLabel(selected, { month: "long", year: "numeric" })}</div>
        <h1 className={s.title}>Schedule</h1>
      </div>
      <div className={s.controls}>
        <button type="button" className={s.iconButton} aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => step(-1)}>‹</button>
        <span className={`${s.rangeLabel} ${s.desktopOnly}`}>{view === "week" ? span(week[0], week[6]) : dateLabel(selected, { month: "long", year: "numeric" })}</span>
        <button type="button" className={s.iconButton} aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => step(1)}>›</button>
        <button type="button" className={`${s.button} ${s.desktopOnly}`} onClick={() => setSelected(today)}>Today</button>
        <div role="group" aria-label="View" className={s.segmented}>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        </div>
      </div>
    </header>
    {error && <p className={s.error} role="alert">{error}</p>}
    {actionError && !sheet && <p className={s.error} role="alert">{actionError}</p>}
    {notice && !sheet && <p className={s.notice} role="status">{notice}</p>}

    {view === "week" ? <>
      <div className={s.mobileOnly}><div className={s.strip} role="group" aria-label="Days of the week">
        {week.map(date => { const count = byDate.get(date)?.length ?? 0;
          return <button key={date} type="button" aria-pressed={date === selected} aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}, ${count} sessions`}
            data-past={date < today || undefined} onClick={() => setSelected(date)}>
            <span>{dateLabel(date, { weekday: "short" }).toUpperCase()}</span><strong>{Number(date.slice(8))}</strong><i className={s.bar} data-past={date < today || undefined} style={{ width: count * 5 }} />
          </button>; })}
      </div></div>
      <div className={s.mobileOnly}>
        {nudge && <p className={s.nudge} style={{ marginBottom: 4 }}>{nudge.client.name} prefers {dateLabel(selected, { weekday: "long" })} {SLOT_NAMES[nudge.slot].toLowerCase()}s and has nothing booked.{" "}
          <button type="button" className={s.link} onClick={() => book(selected, nudge.hour, nudge.client.id)}>Book {shortHour(nudge.hour)} ›</button></p>}
        {SLOTS.map(slot => {
          const [start, end] = SLOT_HOURS[slot];
          const rows = [...day.filter(booking => slotOf(booking.hour) === slot).map(booking => ({ hour: booking.hour, booking })),
            ...freeRanges(start, end, taken, startedThrough(selected)).map(([first, last]) => ({ hour: first, open: [first, last] as const }))].sort((a, b) => a.hour - b.hour);
          return <section key={slot} aria-label={`${SLOT_NAMES[slot]}, ${SLOT_RANGES[slot]}`}>
            <div className={s.groupHead}><span>{SLOT_NAMES[slot]}</span><span>{SLOT_RANGES[slot]}</span></div>
            {!rows.length && <p className={s.empty}>No sessions</p>}
            {rows.map(row => {
              if ("open" in row) {
                const [first, last] = row.open;
                return <div key={`open-${first}`} className={s.row}><button type="button" className={s.rowButton} data-open="" onClick={() => book(selected, first)}>
                  <time>{h12(first)}–{h12(last)}</time><span className={s.who}><strong>Open</strong><span>{last - first} free hour{last - first === 1 ? "" : "s"}</span></span><span className={s.chev} aria-hidden="true">+</span>
                </button></div>;
              }
              const booking = row.booking, state = bookingState(booking, today, hourNow), [meta, tone] = bookingMeta(booking, state, clients.get(booking.personId), today);
              return <div key={booking.id} className={s.row}>
                <button type="button" className={s.rowButton} onClick={() => { setActionError(""); setSheet({ kind: "detail", id: booking.id }); }}>
                  <time dateTime={`${booking.date}T${String(booking.hour).padStart(2, "0")}:00`}>{h12(booking.hour)}:00</time>
                  <span className={s.who}><strong>{nameOf(booking.personId)}</strong><span data-tone={tone}>{meta}</span></span><span className={s.chev} aria-hidden="true">›</span>
                </button>
                {canMark(state) && <div className={s.rowActions}>{markButtons(booking)}</div>}
              </div>;
            })}
          </section>;
        })}
      </div>

      <div className={`${s.weekLayout} ${s.desktopOnly}`}>
        <div className={s.gridBox}><div className={s.gridInner}>
          <div className={s.gridHead}><span />
            {week.map(date => <div key={date} data-today={date === today || undefined} data-past={date < today || undefined}>
              <span>{dateLabel(date, { weekday: "short" }).toUpperCase()}</span><span className={s.dayNum}>{Number(date.slice(8))}</span>
            </div>)}
          </div>
          <div className={s.gridBody}>
            <div className={s.hours} aria-hidden="true">{HOURS.map(hour => <span key={hour} style={{ top: (hour - FIRST_HOUR) * HOUR_PX }}>{shortHour(hour)}</span>)}</div>
            {week.map(date => {
              const bookings = byDate.get(date) ?? [], used = new Set(bookings.map(booking => booking.hour)), through = startedThrough(date);
              return <div key={date} className={s.col} data-today={date === today || undefined}>
                {HOURS.filter(hour => !used.has(hour) && hour > through).map(hour => <button key={hour} type="button" className={s.slot} style={{ top: (hour - FIRST_HOUR) * HOUR_PX + 2 }}
                  aria-label={`Book ${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })} at ${hourLabel(hour)}`} onClick={() => book(date, hour)}>+ {shortHour(hour)}</button>)}
                {bookings.map(booking => {
                  const state = bookingState(booking, today, hourNow), last = state === "booked" && clients.get(booking.personId)?.sessionsLeft === 1;
                  const suffix = { done: " · ✓ Done", no_show: " · No-show", due: " · Mark it", live: " · Now", unmarked: " · Not marked", booked: last ? " · Last" : "" }[state];
                  return <button key={booking.id} type="button" className={s.event} data-state={last ? "last" : state} style={{ top: (booking.hour - FIRST_HOUR) * HOUR_PX + 2 }}
                    onClick={() => { setActionError(""); setSheet({ kind: "detail", id: booking.id }); }}>
                    <strong>{nameOf(booking.personId)}</strong><span>{shortHour(booking.hour)}{suffix}</span>
                  </button>;
                })}
                {date === today && hourNow >= FIRST_HOUR && hourNow <= LAST_HOUR && <span className={s.now} aria-hidden="true" style={{ top: (hourNow - FIRST_HOUR + new Date().getMinutes() / 60) * HOUR_PX }} />}
              </div>;
            })}
          </div>
        </div></div>
        <div className={s.aside}>
          <section className={s.feed} aria-labelledby="due-title">
            <div className={s.feedHead}><h2 id="due-title">Marks due</h2><span>Ended, not marked</span></div>
            {due.length ? due.map(booking => <div key={booking.id} className={s.feedRow} data-wide="">
              <span className={s.who}><strong>{nameOf(booking.personId)}</strong><span>{booking.date === today ? "Today" : dateLabel(booking.date, { weekday: "short", month: "short", day: "numeric" })}, {hourLabel(booking.hour)}–{hourLabel(booking.hour + 1)}</span></span>
              <div>{markButtons(booking)}</div>
            </div>) : <p className={s.feedNote}>Nothing to mark.</p>}
          </section>
          {needsList}
          <p className={s.feedNote} style={{ marginTop: -16 }}>Or click any open hour in the week.</p>
        </div>
      </div>
    </> : <div className={s.monthLayout}>
      <div className={s.monthMain}>
        <div className={s.monthHead} aria-hidden="true">{DAY_KEYS.map(key => <span key={key}>{key.toUpperCase()}</span>)}</div>
        <div className={s.monthGrid}>
          {month.map(date => { const count = byDate.get(date)?.length ?? 0;
            return <button key={date} type="button" aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}, ${count} sessions`}
              data-week={week.includes(date) || undefined} data-past={date < today || undefined} data-out={date.slice(0, 7) !== selected.slice(0, 7) || undefined} data-today={date === today || undefined}
              onClick={() => { setSelected(date); setView("week"); }}>
              <span className={s.dayNum}>{Number(date.slice(8))}</span><i className={s.bar} data-past={date < today || undefined} style={{ width: Math.round(Math.min(count, 4) / 4 * 30) }} />
            </button>; })}
        </div>
        <div className={s.legend}><span><i data-past="" />Done</span><span><i />Booked</span><span>Longer bar = busier day</span></div>
        <section className={s.tiles} aria-label="Month summary">
          <div><h2>Done</h2><strong style={{ color: "var(--rs-success)" }}>{marks.filter(row => row.date.startsWith(selected.slice(0, 7)) && row.outcome === "done").length}</strong></div>
          <div><h2>No-shows</h2><strong>{marks.filter(row => row.date.startsWith(selected.slice(0, 7)) && row.outcome === "no_show").length}</strong></div>
          <div><h2>Upcoming</h2><strong style={{ color: "var(--rs-accent-text)" }}>{shown.filter(row => row.date.startsWith(selected.slice(0, 7)) && bookingState(row, today, hourNow) === "booked").length}</strong></div>
        </section>
      </div>
      <div className={s.aside}>{needsList}</div>
    </div>}

    {sheet?.kind === "book" && <BookingSheet data={data} date={sheet.date} hour={sheet.hour} personId={sheet.personId} onClose={() => setSheet(null)}
      onBook={async (body, done) => { if (await send(api, { action: "book", ...body }, done)) setSheet(null); }} busy={busy} error={actionError} />}
    {detail && <BookingDetail booking={detail} client={clients.get(detail.personId)} state={bookingState(detail, today, hourNow)} busy={busy} error={actionError}
      onClose={() => setSheet(null)} onMark={async outcome => { if (await mark(detail, outcome)) setSheet(null); }}
      onCancel={async () => { if (await send(api, { action: "cancel", bookingId: detail.id }, "Booking cancelled.")) setSheet(null); }} />}
  </main>;
}
