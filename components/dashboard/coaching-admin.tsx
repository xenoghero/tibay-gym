"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { addManilaDays } from "@/lib/coaching/clocks";
import { FIRST_HOUR, LAST_HOUR, SLOT_HOURS, hasStarted, hourLabel, shortHour, slotOf } from "@/lib/coaching/bookings";
import type { TimeSlot } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import { BrandLoading } from "@/components/ui/brand-loading";
import { coachFetch } from "@/app/coach/coach-clients";
import { DAY_KEYS, MESSAGES, SLOT_NAMES, SLOT_RANGES, bookingState, canMark, dateLabel, firstName, firstOfMonth, h12, monthDays, span, weekStart,
  type BookingState, type ScheduleBooking, type ScheduleClient, type ScheduleData } from "@/app/coach/schedule";
import { AdminClients } from "./coaching-admin-clients";
import { AdminBookSheet, AdminBookingDetail, AssignSheet, ClientSheet } from "./coaching-admin-sheets";
import s from "./coaching-admin.module.css";

export type AdminClient = ScheduleClient & { next: { date: string; hour: number; coachId: string } | null };
export type AdminData = Omit<ScheduleData, "clients" | "coaches"> & { clients: AdminClient[]; coaches: { id: string; name: string }[] };
/** Each coach's colour on chips, dots and events, by their order in the coach list (blue and orange first, told apart by lightness too). */
const COLORS = ["#8ab4ff", "#f2a65a", "#c4a7ff", "#7fd4c9", "#ff9db5", "#d9d36a"];
export const coachVar = (color: string) => ({ "--coach": color }) as CSSProperties;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
/** "Mon, Tue mornings" */
export const shortPreference = (client: ScheduleClient) => client.preferredSchedule
  ? `${client.preferredSchedule.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(", ")} ${SLOT_NAMES[client.preferredSchedule.timeSlot].toLowerCase()}s` : "No preferred schedule";
export const adminMessage = (code: string | undefined) => (code && MESSAGES[code]) ?? "Could not save. Check your connection and try again.";

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];
const HOUR_PX = 34, HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const STATUS: Record<BookingState, string> = { done: "✓ Done", no_show: "No-show", due: "Not marked", live: "Not marked", unmarked: "Not marked", booked: "" };
type Sheet = { kind: "book"; date: string; hour: number | null; personId?: string; coachId?: string } | { kind: "detail"; id: string } | { kind: "assign"; personId: string } | { kind: "client"; personId: string } | null;

/** Admin › Coaching: every coach's Schedule and the Clients list, from the "Admin Coaching Redesign" design. */
export function AdminCoaching() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"schedule" | "clients">("schedule"), [view, setView] = useState<"week" | "month">("week");
  const [selected, setSelected] = useState(() => philippineDate(Date.now())), [coach, setCoach] = useState("");
  const [data, setData] = useState<AdminData | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [actionError, setActionError] = useState("");
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addManilaDays(weekStart(selected), i)), [selected]);
  const month = useMemo(() => monthDays(selected), [selected]);
  const from = month[0] < week[0] ? month[0] : week[0], to = month.at(-1)! > week[6] ? month.at(-1)! : week[6];
  useEffect(() => {
    if (!user) return;
    let active = true;
    coachFetch(user, `/api/admin/coach-bookings?from=${from}&to=${to}`).then(async response => {
      if (!response.ok) throw new Error();
      const next: AdminData = await response.json();
      if (active) { setData(next); setError(""); }
    }).catch(() => { if (active) setError("Could not load coaching. Reload to try again."); });
    return () => { active = false; };
  }, [user, from, to, reload]);

  async function send(path: string, body: Record<string, unknown>, done: string) {
    if (busy || !user) return false;
    setBusy(true); setActionError(""); setNotice("");
    try {
      const response = await coachFetch(user, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(adminMessage((await response.json().catch(() => ({}))).error));
      setNotice(done); setReload(v => v + 1);
      return true;
    } catch (err) { setActionError(err instanceof Error ? err.message : "Could not save."); return false; }
    finally { setBusy(false); }
  }
  const open = (next: Sheet) => { setActionError(""); setNotice(""); setSheet(next); };

  const header = <header className={s.head}>
    <div><div className={s.kicker}>Clients &amp; coaches</div><h1 className={s.title}>Coaching</h1>
      <p className={s.sub}>Book clients with their coach and see every coach’s week. Sessions already done stay credited to the coach who ran them.</p></div>
    {data && <button type="button" className={`${s.button} ${s.primary} ${s.bookButton} ${s.desktopOnly}`} onClick={() => open({ kind: "book", date: selected < data.today ? data.today : selected, hour: null, coachId: coach || undefined })}><span aria-hidden="true">+</span>Book session</button>}
  </header>;
  const tabs = <div role="group" aria-label="Coaching view" className={s.tabs}>
    <button type="button" aria-pressed={tab === "schedule"} onClick={() => setTab("schedule")}>Schedule</button>
    <button type="button" aria-pressed={tab === "clients"} onClick={() => setTab("clients")}>Clients {data && <span className={s.count}>{data.clients.length}</span>}</button>
  </div>;
  if (!data) return <main className={s.page}>{header}{tabs}{error
    ? <><p className={s.error} role="alert">{error}</p><button type="button" className={s.button} style={{ alignSelf: "flex-start" }} onClick={() => setReload(v => v + 1)}>Retry</button></>
    : <BrandLoading label="Loading coaching" />}</main>;

  const { today, hourNow } = data;
  const colors = new Map(data.coaches.map((row, index) => [row.id, COLORS[index % COLORS.length]]));
  const coachNames = new Map(data.coaches.map(row => [row.id, row.name]));
  const colorOf = (id: string | null | undefined) => (id && colors.get(id)) || "var(--rs-muted)";
  const coachName = (id: string | null | undefined) => (id && coachNames.get(id)) || "Former coach";
  const clients = new Map(data.clients.map(client => [client.id, client]));
  const nameOf = (id: string) => clients.get(id)?.name ?? "Former client";
  const shown = coach ? data.bookings.filter(booking => booking.coachId === coach) : data.bookings;
  const byDate = new Map<string, ScheduleBooking[]>();
  for (const booking of [...shown].sort((a, b) => a.hour - b.hour)) byDate.set(booking.date, [...byDate.get(booking.date) ?? [], booking]);
  const scope = coach ? data.coaches.filter(row => row.id === coach) : data.coaches;
  const startedThrough = (date: string) => date < today ? 99 : date === today ? hourNow : -1;
  const freeAt = (date: string, hour: number) => scope.filter(row => !data.bookings.some(booking => booking.date === date && booking.hour === hour && booking.coachId === row.id));
  const needs = data.clients.filter(client => client.needsBooking && (!coach || !client.coachId || client.coachId === coach));
  const due = shown.filter(booking => canMark(bookingState(booking, today, hourNow))).sort((a, b) => b.date.localeCompare(a.date) || b.hour - a.hour);
  const step = (direction: number) => setSelected(view === "week" ? addManilaDays(selected, 7 * direction) : firstOfMonth(selected, direction));
  const book = (date: string, hour: number | null, personId?: string) => open({ kind: "book", date: date < today ? today : date, hour, personId, coachId: coach || undefined });
  const when = (booking: { date: string; hour: number }) => `${booking.date === today ? "today" : dateLabel(booking.date, { weekday: "short", month: "short", day: "numeric" })}, ${h12(booking.hour)}–${h12(booking.hour + 1)} ${booking.hour + 1 < 12 ? "AM" : "PM"}`;

  const chips = <div role="group" aria-label="Coach" className={s.chips}>
    <button type="button" className={s.chip} aria-pressed={!coach} onClick={() => setCoach("")}>All coaches</button>
    {data.coaches.map(row => <button key={row.id} type="button" className={s.chip} aria-pressed={coach === row.id} style={coachVar(colorOf(row.id))} onClick={() => setCoach(row.id)}>
      <span className={s.dot} aria-hidden="true" />{row.name}</button>)}
  </div>;
  const toolbar = <div className={s.toolbar}>
    {tabs}
    <div className={s.tools}>
      {chips}
      <span className={`${s.divider} ${s.desktopOnly}`} aria-hidden="true" />
      <div className={s.navRow}>
        <div className={s.navGroup}>
          <button type="button" className={s.iconButton} aria-label={view === "week" ? "Previous week" : "Previous month"} onClick={() => step(-1)}>‹</button>
          <span className={s.rangeLabel}>{view === "week" ? span(week[0], week[6]) : dateLabel(selected, { month: "short", year: "numeric" })}</span>
          <button type="button" className={s.iconButton} aria-label={view === "week" ? "Next week" : "Next month"} onClick={() => step(1)}>›</button>
          <button type="button" className={`${s.button} ${s.desktopOnly}`} onClick={() => setSelected(today)}>Today</button>
        </div>
        <div role="group" aria-label="View" className={s.segmented}>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>Month</button>
        </div>
      </div>
    </div>
  </div>;

  /** The agenda line under a client's name: their coach, then the session's state. */
  const agendaMeta = (booking: ScheduleBooking, state: BookingState): [string, string | undefined] => {
    const client = clients.get(booking.personId);
    if (state === "done") return ["✓ Done", "success"];
    if (state === "no_show") return ["No-show", undefined];
    if (state === "unmarked") return ["Not marked", undefined];
    if (state === "due" || state === "live") return [booking.date === today ? "Ended · not marked yet" : "Not marked yet", "accent"];
    if (client?.sessionsLeft === 1) return ["Last session · remind to renew", "accent"];
    const minutes = booking.hour * 60 - (hourNow * 60 + new Date().getMinutes());
    return [`${booking.date === today && minutes > 0 && minutes < 60 ? `In ${minutes} min · ` : ""}${client ? `${client.sessionsLeft} left` : ""}`, undefined];
  };
  const freeText = (run: number[]) => {
    const free = scope.filter(row => run.every(hour => freeAt(selected, hour).some(other => other.id === row.id)));
    if (scope.length === 1) return `${firstName(scope[0].name)} free`;
    if (free.length === scope.length) return scope.length === 2 ? "Both coaches free" : "All coaches free";
    return free.length ? `${free.map(row => firstName(row.name)).join(" · ")} free` : "Some coaches free";
  };
  const day = byDate.get(selected) ?? [];
  const agenda = SLOTS.map(slot => {
    const [start, end] = SLOT_HOURS[slot], runs: number[][] = [];
    for (let hour = start; hour < end; hour++) {
      if (hour <= startedThrough(selected) || !freeAt(selected, hour).length) continue;
      const last = runs.at(-1);
      if (last && last.at(-1) === hour - 1) last.push(hour); else runs.push([hour]);
    }
    const rows = [...day.filter(booking => slotOf(booking.hour) === slot).map(booking => ({ hour: booking.hour, booking })),
      ...runs.map(run => ({ hour: run[0], run }))].sort((a, b) => a.hour - b.hour);
    return { slot, rows };
  });

  const markedSummary = (prefix: string) => {
    const marks = data.marks.filter(row => row.date.startsWith(prefix) && (!coach || row.coachId === coach));
    return { done: marks.filter(row => row.outcome === "done").length, noShows: marks.filter(row => row.outcome === "no_show").length };
  };
  const needsList = <section className={s.feed} aria-labelledby="needs-title">
    <div className={s.feedHead}><h2 id="needs-title">Needs a booking</h2><span>Next 7 days</span></div>
    {needs.length ? needs.map(client => <div key={client.id} className={s.feedRow}>
      <span className={s.avatar} aria-hidden="true">{initials(client.name)}</span>
      <span className={s.who}><strong>{client.name}</strong>{client.coachId
        ? <span className={s.meta}>{firstName(coachName(client.coachId))} · nothing booked this week · {client.sessionsLeft} left</span>
        : <span className={s.meta} data-tone="accent">No coach yet · {client.sessionsLeft} sessions · {shortPreference(client)}</span>}</span>
      <button type="button" className={`${s.button} ${s.small} ${client.coachId ? "" : s.primary}`} onClick={() => book(selected, null, client.id)}>{client.coachId ? "Book" : "Assign & book"}</button>
    </div>) : <p className={s.feedNote}>Every client with sessions has one booked this week.</p>}
  </section>;

  const content = tab === "clients" ? <AdminClients data={data} colorOf={colorOf} coachName={coachName} tabs={tabs} busy={busy}
    onAssign={personId => open({ kind: "assign", personId })} onBook={personId => book(today, null, personId)} onOpen={personId => open({ kind: "client", personId })} />
    : <>
      {toolbar}
      {view === "week" ? <>
        <div className={s.mobileOnly}><div className={s.strip} role="group" aria-label="Days">
          {week.map(date => { const list = byDate.get(date) ?? [];
            return <button key={date} type="button" aria-pressed={date === selected} data-past={date < today || undefined} onClick={() => setSelected(date)}
              aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} sessions`}>
              <span>{dateLabel(date, { weekday: "short" }).toUpperCase()}</span><strong>{Number(date.slice(8))}</strong>
              <span className={s.dots}>{list.slice(0, 4).map(booking => <i key={booking.id} style={coachVar(colorOf(booking.coachId))} />)}</span>
            </button>; })}
        </div></div>
        <div className={s.mobileOnly}>
          <div className={s.dayHead}><h2>{dateLabel(selected, { weekday: "long", month: "short", day: "numeric" })}</h2>
            <span>{day.length} session{day.length === 1 ? "" : "s"}{day.length ? ` · ${new Set(day.map(booking => booking.coachId)).size} coach${new Set(day.map(booking => booking.coachId)).size === 1 ? "" : "es"}` : ""}</span></div>
        </div>
        <div className={s.mobileOnly}>
          {agenda.map(({ slot, rows }) => <section key={slot} aria-label={`${SLOT_NAMES[slot]}, ${SLOT_RANGES[slot]}`}>
            <div className={s.groupHead}><span>{SLOT_NAMES[slot]}</span><span>{SLOT_RANGES[slot]}</span></div>
            {!rows.length && <p className={s.empty}>{selected < today ? "No sessions" : "Fully booked"}</p>}
            {rows.map(row => {
              if ("run" in row) {
                const run = row.run!, first = run[0], last = run.at(-1)! + 1;
                return <button key={`open-${first}`} type="button" className={s.row} data-open="" onClick={() => book(selected, first)}>
                  <time>{h12(first)}–{h12(last)}</time>
                  <span className={s.who}><strong>Open · {run.length} free hour{run.length === 1 ? "" : "s"}</strong><span className={s.meta}>{freeText(run)}</span></span>
                  <span className={s.chev} aria-hidden="true">+</span>
                </button>;
              }
              const booking = row.booking!, state = bookingState(booking, today, hourNow), [meta, tone] = agendaMeta(booking, state);
              return <button key={booking.id} type="button" className={s.row} onClick={() => open({ kind: "detail", id: booking.id })}>
                <time dateTime={`${booking.date}T${String(booking.hour).padStart(2, "0")}:00`}>{h12(booking.hour)}:00</time>
                <span className={s.who}><strong>{nameOf(booking.personId)}</strong>
                  <span className={s.meta}><span className={s.dot} style={coachVar(colorOf(booking.coachId))} aria-hidden="true" /><b>{firstName(coachName(booking.coachId))}</b><span aria-hidden="true">·</span><span data-tone={tone}>{meta}</span></span></span>
                <span className={s.chev} aria-hidden="true">›</span>
              </button>;
            })}
          </section>)}
        </div>

        <div className={`${s.weekLayout} ${s.desktopOnly}`}>
          <div className={s.gridBox}><div className={s.gridInner}>
            <div className={s.gridHead}><span />
              {week.map(date => <div key={date}><span><small>{dateLabel(date, { weekday: "short" }).toUpperCase()}</small>
                <span className={s.dayNum} data-today={date === today || undefined} data-past={date < today || undefined}>{Number(date.slice(8))}</span></span>
                <span>{byDate.get(date)?.length || ""}</span></div>)}
            </div>
            <div className={s.gridBody}>
              <div className={s.hours} aria-hidden="true">{HOURS.map(hour => <span key={hour} style={{ top: (hour - FIRST_HOUR) * HOUR_PX }}>{shortHour(hour)}</span>)}</div>
              {week.map(date => {
                const list = byDate.get(date) ?? [], through = startedThrough(date);
                return <div key={date} className={s.col} data-today={date === today || undefined}>
                  {HOURS.filter(hour => hour > through && freeAt(date, hour).length).map(hour => <button key={hour} type="button" className={s.slot} style={{ top: (hour - FIRST_HOUR) * HOUR_PX + 2 }}
                    aria-label={`Book ${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })} at ${hourLabel(hour)}`} onClick={() => book(date, hour)}>+ {shortHour(hour)}</button>)}
                  {list.map(booking => {
                    const state = bookingState(booking, today, hourNow), last = state === "booked" && clients.get(booking.personId)?.sessionsLeft === 1;
                    const same = list.filter(other => other.hour === booking.hour), lane = same.indexOf(booking), name = nameOf(booking.personId);
                    const status = last ? "Last session" : STATUS[state], coachFirst = firstName(coachName(booking.coachId));
                    return <button key={booking.id} type="button" className={s.event} data-state={last ? "last" : state}
                      title={`${name} with ${coachFirst} · ${shortHour(booking.hour)}${status ? ` · ${status}` : ""}`} onClick={() => open({ kind: "detail", id: booking.id })}
                      style={{ ...coachVar(colorOf(booking.coachId)), top: (booking.hour - FIRST_HOUR) * HOUR_PX + 2,
                        left: same.length > 1 ? `calc(3px + ${lane} * (100% - 6px) / ${same.length})` : 3, width: same.length > 1 ? `calc((100% - 6px) / ${same.length} - 2px)` : "calc(100% - 6px)" }}>
                      <strong>{same.length > 1 ? firstName(name) : name}</strong><span>{shortHour(booking.hour)} · {coachFirst}{status ? ` · ${status}` : ""}</span>
                    </button>;
                  })}
                  {date === today && hourNow >= FIRST_HOUR && hourNow <= LAST_HOUR && <span className={s.now} aria-hidden="true" style={{ top: (hourNow - FIRST_HOUR + new Date().getMinutes() / 60) * HOUR_PX }} />}
                </div>;
              })}
            </div>
          </div></div>
          <div className={s.aside}>
            <section className={s.feed} aria-labelledby="due-title">
              <div className={s.feedHead}><h2 id="due-title">Not marked yet</h2><span>Coaches mark these</span></div>
              {due.length ? due.map(booking => <div key={booking.id} className={s.feedRow} data-plain="">
                <span className={s.who}><strong>{nameOf(booking.personId)}</strong>
                  <span className={s.meta}><span className={s.dot} style={coachVar(colorOf(booking.coachId))} aria-hidden="true" />{coachName(booking.coachId)} · {when(booking)}</span></span>
                <button type="button" className={s.link} onClick={() => open({ kind: "detail", id: booking.id })}>View</button>
              </div>) : <p className={s.feedNote}>Every ended session is marked.</p>}
            </section>
            {needsList}
          </div>
        </div>
        <button type="button" className={s.fab} onClick={() => book(selected, null)}><span aria-hidden="true">+</span>Book session</button>
      </> : <div className={s.split}>
        <div className={s.monthMain}>
          <div className={s.monthHead} aria-hidden="true">{DAY_KEYS.map(key => <span key={key}>{key.toUpperCase()}</span>)}</div>
          <div className={s.monthGrid}>
            {month.map(date => { const list = byDate.get(date) ?? [];
              return <button key={date} type="button" aria-label={`${dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} sessions`}
                data-week={week.includes(date) || undefined} onClick={() => { setSelected(date); setView("week"); }}>
                <span className={s.dayNum} data-today={date === today || undefined} data-past={date < today || date.slice(0, 7) !== selected.slice(0, 7) || undefined}>{Number(date.slice(8))}</span>
                <span className={s.dots}>{list.slice(0, 4).map(booking => <i key={booking.id} style={coachVar(colorOf(booking.coachId))} />)}</span>
              </button>; })}
          </div>
          <div className={s.legend}>{scope.map(row => <span key={row.id}><span className={s.dot} style={coachVar(colorOf(row.id))} aria-hidden="true" />{firstName(row.name)}</span>)}<span>One dot = one session</span></div>
          {(() => { const totals = markedSummary(selected.slice(0, 7));
            return <section className={s.tiles} aria-label={`${dateLabel(selected, { month: "long" })} totals`}>
              <div><h2>Done</h2><strong style={{ color: "var(--rs-success)" }}>{totals.done}</strong></div>
              <div><h2>No-shows</h2><strong>{totals.noShows}</strong></div>
              <div><h2>Upcoming</h2><strong style={{ color: "var(--rs-accent-text)" }}>{shown.filter(row => row.date.startsWith(selected.slice(0, 7)) && !hasStarted(row.date, row.hour, today, hourNow)).length}</strong></div>
            </section>; })()}
        </div>
        <div className={s.aside}>{needsList}</div>
      </div>}
    </>;

  const detail = sheet?.kind === "detail" ? data.bookings.find(booking => booking.id === sheet.id) : undefined;
  const sheetClient = sheet && (sheet.kind === "assign" || sheet.kind === "client") ? clients.get(sheet.personId) : undefined;
  return <main className={s.page}>
    {header}
    {(actionError && !sheet) && <p className={s.error} role="alert">{actionError}</p>}
    {(notice && !sheet) && <p className={s.notice} role="status">{notice}</p>}
    {content}
    {sheet?.kind === "book" && <AdminBookSheet data={data} colorOf={colorOf} date={sheet.date} hour={sheet.hour} personId={sheet.personId} coachId={sheet.coachId} busy={busy} error={actionError}
      onClose={() => setSheet(null)} onBook={async (body, done) => { if (await send("/api/admin/coach-bookings", { action: "book", ...body }, done)) setSheet(null); }} />}
    {detail && <AdminBookingDetail booking={detail} client={clients.get(detail.personId)} coachName={coachName(detail.coachId)} color={colorOf(detail.coachId)}
      state={bookingState(detail, today, hourNow)} busy={busy} error={actionError} onClose={() => setSheet(null)}
      onOpenClient={() => open({ kind: "client", personId: detail.personId })}
      onCancel={async () => { if (await send("/api/admin/coach-bookings", { action: "cancel", bookingId: detail.id }, "Booking cancelled.")) setSheet(null); }} />}
    {sheet?.kind === "assign" && sheetClient && <AssignSheet data={data} client={sheetClient} colorOf={colorOf} busy={busy} error={actionError} onClose={() => setSheet(null)}
      onAssign={async (coachId, bookNext) => {
        const done = await send("/api/admin/coach-assignments", { personId: sheetClient.id, coachId }, `${sheetClient.name} is now coached by ${coachName(coachId)}.`);
        if (done) setSheet(bookNext ? { kind: "book", date: today, hour: null, personId: sheetClient.id, coachId } : null);
      }} />}
    {sheet?.kind === "client" && sheetClient && user && <ClientSheet user={user} client={sheetClient} coachName={coachName} colorOf={colorOf}
      onClose={() => setSheet(null)} onChanged={() => setReload(v => v + 1)}
      onBook={() => book(today, null, sheetClient.id)} onSwitch={() => open({ kind: "assign", personId: sheetClient.id })} />}
  </main>;
}
