"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { addManilaDays } from "@/lib/coaching/clocks";
import { LAST_HOUR, MAX_REPEAT_WEEKS, SLOT_HOURS, hourLabel, shortHour, slotOf } from "@/lib/coaching/bookings";
import type { TimeSlot } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import { coachFetch } from "@/app/coach/coach-clients";
import { SLOT_NAMES, bookableClient, canMark, dateLabel, dayKey, firstName, h12, preferenceText, type BookingState, type ScheduleBooking } from "@/app/coach/schedule";
import { coachVar, initials, shortPreference, type AdminClient, type AdminData } from "./coaching-admin";
import s from "./coaching-admin.module.css";

/** A modal <dialog>: a bottom sheet on phones, centred on desktops. Esc, the backdrop and × all call onClose. */
function Sheet({ kicker, title, onClose, children }: { kicker: ReactNode; title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, []);
  return <dialog ref={ref} className={s.sheet} aria-labelledby="admin-sheet-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className={s.sheetBody}>
      <div className={s.sheetHead}>
        <div><p>{kicker}</p><h2 id="admin-sheet-title">{title}</h2></div>
        <button type="button" className={s.close} aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>
      {children}
    </div>
  </dialog>;
}

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];
const weekdayName = (date: string) => dateLabel(date, { weekday: "long" });
const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Starts at first session";
const clientCounts = (data: AdminData, coachId: string) => data.clients.filter(client => client.coachId === coachId).length;

/** Book: client, then coach (assigning an unassigned client), then day and hour, optionally weekly. */
export function AdminBookSheet({ data, colorOf, date, hour, personId, coachId: presetCoach, busy, error, onClose, onBook }: {
  data: AdminData; colorOf(id: string | null | undefined): string; date: string; hour: number | null; personId?: string; coachId?: string; busy: boolean; error: string; onClose(): void;
  onBook(body: { personId: string; coachId: string; date: string; hour: number; weeks: number }, done: string): void;
}) {
  const preset = data.clients.find(client => client.id === personId), preferred = preset?.preferredSchedule?.timeSlot ?? "morning";
  // Opened without an hour late in the day: start on the next slot that still has hours, or tomorrow.
  const startDay = hour === null && date === data.today && data.hourNow >= LAST_HOUR ? addManilaDays(date, 1) : date;
  const startSlot = hour !== null ? slotOf(hour) : startDay === data.today && SLOT_HOURS[preferred][1] - 1 <= data.hourNow ? slotOf(data.hourNow + 1) : preferred;
  const [day, setDay] = useState(startDay), [slot, setSlot] = useState<TimeSlot>(startSlot);
  const [chosenHour, setHour] = useState(hour), [chosen, setChosen] = useState(personId ?? null), [picking, setPicking] = useState(!personId);
  const [pickedCoach, setCoach] = useState(presetCoach ?? ""), [repeat, setRepeat] = useState(false);
  const client = data.clients.find(row => row.id === chosen), coachId = client?.coachId ?? pickedCoach;
  const coach = data.coaches.find(row => row.id === coachId);
  const onDay = data.bookings.filter(booking => booking.date === day), names = new Map(data.clients.map(row => [row.id, row.name]));
  const through = day === data.today ? data.hourNow : day < data.today ? 99 : -1, [first, end] = SLOT_HOURS[slot];
  const busyCoach = (id: string, at: number) => onDay.find(booking => booking.coachId === id && booking.hour === at);
  const hours = Array.from({ length: end - first }, (_, i) => first + i).map(value => {
    const taken = coachId ? busyCoach(coachId, value) : data.coaches.every(row => busyCoach(row.id, value)) ? onDay.find(booking => booking.hour === value) : undefined;
    return { value, past: value <= through, note: taken ? `${firstName(names.get(taken.personId) ?? "Booked")} · ${firstName(data.coaches.find(row => row.id === taken.coachId)?.name ?? "Coach")}` : null };
  });
  const dayChips = Array.from({ length: 14 }, (_, i) => addManilaDays(data.today, i));
  if (!dayChips.includes(day)) dayChips.push(day);
  const ranked = data.clients.map(row => {
    const spare = row.sessionsLeft - row.booked, pref = row.preferredSchedule, sameDay = onDay.find(booking => booking.personId === row.id);
    const match = !sameDay && !!pref && (pref.weekdays as string[]).includes(dayKey(day)) && pref.timeSlot === slot;
    const ok = bookableClient(row) && spare > 0;
    const note = row.frozen ? "Frozen · can’t be booked" : !bookableClient(row) ? "No sessions left · renew first" : spare <= 0 ? "Every session is already booked"
      : sameDay ? `Booked ${hourLabel(sameDay.hour)} that day` : match ? `✓ Prefers ${weekdayName(day)} ${SLOT_NAMES[slot].toLowerCase()}s` : preferenceText(row);
    return { row, spare, ok, match, note: `${row.coachName ?? "No coach yet"} · ${note}` };
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.match) - Number(a.match) || Number(b.row.needsBooking) - Number(a.row.needsBooking) || a.row.name.localeCompare(b.row.name));
  const pick = ranked.find(entry => entry.row.id === chosen && entry.ok);
  const lastDay = pick?.row.coachingExpiresAt ? philippineDate(pick.row.coachingExpiresAt - 1) : null;
  let weeks = 0;
  while (pick && weeks < Math.min(pick.spare, MAX_REPEAT_WEEKS) && (!lastDay || addManilaDays(day, weeks * 7) <= lastDay)) weeks++;
  const free = chosenHour !== null && !hours.find(row => row.value === chosenHour)?.note && !hours.find(row => row.value === chosenHour)?.past;
  const repeating = repeat && weeks > 1, ready = !!pick && !!coach && free && weeks > 0;
  const label = !pick || chosenHour === null ? "Choose a client and time" : !coach ? "Choose a coach" : !free ? "That hour is taken" : weeks === 0 ? "After their coaching ends"
    : repeating ? `Book ${weeks} ${weekdayName(day)}s with ${firstName(coach.name)}` : `Book ${firstName(pick.row.name)} with ${firstName(coach.name)} · ${shortHour(chosenHour)}`;

  return <Sheet kicker={`${dateLabel(day, { weekday: "short", month: "short", day: "numeric" })} · ${SLOT_NAMES[slot]}`} title="Book a session" onClose={onClose}>
    <div className={s.field}>
      <span className={s.label}>Client</span>
      {client && !picking ? <button type="button" className={s.card} onClick={() => setPicking(true)}>
        <span className={s.avatar} aria-hidden="true">{initials(client.name)}</span>
        <span className={s.who}><strong>{client.name}</strong><span>{client.coachName ?? "No coach yet"} · {client.sessionsLeft} sessions · {shortPreference(client)}</span></span>
        <span className={s.cardAction}>Change</span>
      </button> : <ul className={s.picker}>{ranked.map(({ row, ok, match, note }) => <li key={row.id}>
        <button type="button" className={s.card} disabled={!ok} aria-pressed={chosen === row.id} onClick={() => { setChosen(row.id); setPicking(false); if (row.coachId) setCoach(row.coachId); }}>
          <span className={s.avatar} aria-hidden="true">{initials(row.name)}</span>
          <span className={s.who}><strong>{row.name}</strong><span data-tone={match && ok ? "success" : undefined}>{note}</span></span>
          <span className={s.left}>{row.sessionsLeft}<small>Left</small></span>
        </button>
      </li>)}</ul>}
    </div>

    <div className={s.field}>
      <span className={s.label}>Coach {client && <span>· {client.coachId ? `${firstName(client.name)}’s coach` : `booking assigns them to ${firstName(client.name)}`}</span>}</span>
      <div role="radiogroup" aria-label="Coach" className={s.coachCards}>
        {data.coaches.map(row => { const taken = chosenHour !== null ? busyCoach(row.id, chosenHour) : undefined, count = clientCounts(data, row.id);
          return <button key={row.id} type="button" role="radio" aria-checked={coachId === row.id} className={s.coachCard} style={coachVar(colorOf(row.id))}
            disabled={!!client?.coachId && client.coachId !== row.id} onClick={() => setCoach(row.id)}>
            <span><span className={s.dot} aria-hidden="true" style={{ width: 8, height: 8 }} />{row.name}</span>
            <span data-tone={chosenHour !== null && !taken ? "success" : undefined}>{chosenHour === null ? "" : `${taken ? "Busy" : "Free"} at ${shortHour(chosenHour)} · `}{count} client{count === 1 ? "" : "s"}</span>
          </button>; })}
        {!data.coaches.length && <p className={s.error}>Create a coach in Settings → Coaching first.</p>}
      </div>
    </div>

    <div className={s.field}>
      <span className={s.label}>Day</span>
      <div className={s.dayChips} role="group" aria-label="Day">
        {dayChips.map(value => <button key={value} type="button" className={s.dayChip} aria-pressed={day === value} data-dim={(value === data.today && data.hourNow >= 21) || undefined}
          aria-label={dateLabel(value, { weekday: "long", month: "long", day: "numeric" })} onClick={() => { setDay(value); setHour(null); }}>
          <span>{dateLabel(value, { weekday: "short" }).toUpperCase()}</span><span>{Number(value.slice(8))}</span>
        </button>)}
      </div>
    </div>

    <div className={s.field}>
      <div className={s.fieldRow}><span className={s.label}>Time</span>
        <div role="group" aria-label="Time slot" className={s.slotTabs}>
          {SLOTS.map(value => <button key={value} type="button" aria-pressed={slot === value} onClick={() => { setSlot(value); setHour(null); }}>{SLOT_NAMES[value]}</button>)}
        </div>
      </div>
      <div className={s.hourChips}>{hours.map(({ value, past, note }) => <button key={value} type="button" className={s.hourChip} disabled={past || !!note} aria-pressed={chosenHour === value} onClick={() => setHour(value)}>
        <span>{shortHour(value)}</span><span>{past ? "Past" : note ?? "Free"}</span>
      </button>)}</div>
    </div>

    {pick && chosenHour !== null && weeks > 1 && <label className={s.switchRow}>
      <span><span>Repeat every {weekdayName(day)}</span><span>{hourLabel(chosenHour)} through {dateLabel(addManilaDays(day, (weeks - 1) * 7), { month: "short", day: "numeric" })} · {weeks} of {firstName(pick.row.name)}’s {pick.row.sessionsLeft} sessions</span></span>
      <input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} />
    </label>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.sheetActions}>
      <button type="button" className={s.button} onClick={onClose}>Cancel</button>
      <button type="button" className={`${s.button} ${s.primary}`} disabled={!ready || busy} onClick={() => pick && coach && chosenHour !== null && onBook({ personId: pick.row.id, coachId: coach.id, date: day, hour: chosenHour, weeks: repeating ? weeks : 1 },
        repeating ? `Booked ${pick.row.name} with ${coach.name} every ${weekdayName(day)} at ${hourLabel(chosenHour)} (${weeks} sessions).`
          : `Booked ${pick.row.name} with ${coach.name} on ${dateLabel(day, { weekday: "short", month: "short", day: "numeric" })} at ${hourLabel(chosenHour)}.`)}>
        {busy ? "Booking…" : label}
      </button>
    </div>
  </Sheet>;
}

/** One booking in the admin's view: the coach marks it; the admin can open the client or cancel while unmarked. */
export function AdminBookingDetail({ booking, client, coachName, color, state, busy, error, onClose, onOpenClient, onCancel }: {
  booking: ScheduleBooking; client: AdminClient | undefined; coachName: string; color: string; state: BookingState; busy: boolean; error: string;
  onClose(): void; onOpenClient(): void; onCancel(): void;
}) {
  return <Sheet kicker={<><span className={s.dot} style={coachVar(color)} aria-hidden="true" />{coachName} · {dateLabel(booking.date, { weekday: "short", month: "short", day: "numeric" })} · {hourLabel(booking.hour)}–{hourLabel(booking.hour + 1)}</>}
    title={client?.name ?? "Former client"} onClose={onClose}>
    {state === "booked" && client?.sessionsLeft === 1 && <p className={s.notice}>Last session. Remind {firstName(client.name)} to renew.</p>}
    {booking.mark && <p className={s.notice} role="status">{booking.mark.outcome === "done" ? "✓ Session done." : "No-show recorded. No session was used."}</p>}
    {canMark(state) && <p className={s.notice}>Ended and not marked yet. {coachName} marks it from the coach portal.</p>}
    {client && <dl className={s.facts}>
      <div><dt>Sessions left</dt><dd className={s.factBig} style={{ color: client.sessionsLeft <= 1 ? "var(--rs-accent-text)" : undefined }}>{client.sessionsLeft}</dd></div>
      <div><dt>Coaching until</dt><dd>{until(client.coachingExpiresAt)}</dd></div>
      <div style={{ gridColumn: "1 / -1" }}><dt>Prefers</dt><dd>{preferenceText(client).replace(/^Prefers /, "")}</dd></div>
      {booking.seriesId && <div style={{ gridColumn: "1 / -1" }}><dt>Repeats</dt><dd>Every {weekdayName(booking.date)} at {hourLabel(booking.hour)}</dd></div>}
    </dl>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.sheetActions} style={{ gridTemplateColumns: booking.mark ? "1fr" : "1fr 1fr" }}>
      <button type="button" className={s.button} onClick={onOpenClient} disabled={!client}>Open client</button>
      {!booking.mark && <button type="button" className={s.button} style={{ borderColor: "var(--rs-danger)", color: "var(--rs-danger)" }} disabled={busy} onClick={onCancel}>Cancel booking</button>}
    </div>
  </Sheet>;
}

/** Assign or switch a client's coach, with each coach's load and whether they're free at the client's preferred times. */
export function AssignSheet({ data, client, colorOf, busy, error, onClose, onAssign }: {
  data: AdminData; client: AdminClient; colorOf(id: string | null | undefined): string; busy: boolean; error: string; onClose(): void; onAssign(coachId: string, bookNext: boolean): void;
}) {
  const options = data.coaches.filter(row => row.id !== client.coachId);
  const [chosen, setChosen] = useState(options[0]?.id ?? ""), [bookNext, setBookNext] = useState(!client.coachId);
  const pref = client.preferredSchedule, days = Array.from({ length: 7 }, (_, i) => addManilaDays(data.today, i));
  const fit = (coachId: string) => {
    if (!pref) return null;
    const [first, end] = SLOT_HOURS[pref.timeSlot], wanted = days.filter(date => (pref.weekdays as string[]).includes(dayKey(date)));
    const busyDay = wanted.map(date => ({ date, hours: data.bookings.filter(booking => booking.coachId === coachId && booking.date === date && booking.hour >= first && booking.hour < end).map(booking => booking.hour) }))
      .find(row => row.hours.length);
    const label = pref.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(" & ");
    if (!busyDay) return { good: true, text: `✓ Free ${label} ${SLOT_NAMES[pref.timeSlot].toLowerCase()}s` };
    const low = Math.min(...busyDay.hours), high = Math.max(...busyDay.hours) + 1;
    return { good: false, text: `Busy ${dateLabel(busyDay.date, { weekday: "short" })} ${h12(low)}–${shortHour(high)}` };
  };
  const coach = data.coaches.find(row => row.id === chosen), weekEnd = days[6];
  return <Sheet kicker={`${client.name} · ${client.sessionsLeft} sessions · ${shortPreference(client)}`} title={client.coachId ? "Switch coach" : "Assign a coach"} onClose={onClose}>
    {client.coachId && <p className={s.notice}>Now with {client.coachName}. Sessions already done stay credited to them; booked sessions stay with them until cancelled.</p>}
    <div role="radiogroup" aria-label="Coach" className={s.picker}>
      {options.map(row => { const result = fit(row.id), count = data.clients.filter(other => other.coachId === row.id).length;
        const sessions = data.bookings.filter(booking => booking.coachId === row.id && booking.date >= data.today && booking.date <= weekEnd).length;
        return <button key={row.id} type="button" role="radio" aria-checked={chosen === row.id} className={s.radioCard} style={coachVar(colorOf(row.id))} onClick={() => setChosen(row.id)}>
          <span className={s.dot} aria-hidden="true" />
          <span className={s.who}><strong>{row.name}</strong><span>{count} client{count === 1 ? "" : "s"} · {sessions} session{sessions === 1 ? "" : "s"} this week</span>
            {result && <span data-tone={result.good ? "success" : undefined}>{result.text}</span>}</span>
          <span className={s.radio} aria-hidden="true" />
        </button>; })}
      {!options.length && <p className={s.error}>Create another coach in Settings → Coaching first.</p>}
    </div>
    {!client.coachId && <label className={s.switchRow}>
      <span><span>Book the first session next</span><span>Opens booking with {coach ? firstName(coach.name) : "the coach"} after assigning</span></span>
      <input type="checkbox" checked={bookNext} onChange={event => setBookNext(event.target.checked)} />
    </label>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.sheetActions}>
      <button type="button" className={s.button} onClick={onClose}>Cancel</button>
      <button type="button" className={`${s.button} ${s.primary}`} disabled={!coach || busy} onClick={() => coach && onAssign(coach.id, bookNext)}>
        {busy ? "Saving…" : coach ? `${client.coachId ? "Switch to" : "Assign"} ${coach.name}` : "Choose a coach"}</button>
    </div>
  </Sheet>;
}

interface Mark { id: string; date: string; outcome: "done" | "no_show"; note: string | null; coachName: string }
interface Holding { id: string; topUp: boolean; sessions: number; sessionsLeft: number }
const ERRORS: Record<string, string> = { "adjustment-reason-required": "Enter a reason for the adjustment.", "no-sessions-left": "The client has no sessions left to use.",
  "coaching-expired": "The client's coaching validity has ended.", "invalid-sessions-left": "Enter a whole number of sessions, 0 or more." };

/** A client: what's left and next, Book / Switch coach / Adjust, and their session history with Fix and Undo. */
export function ClientSheet({ user, client, coachName, colorOf, onClose, onChanged, onBook, onSwitch }: {
  user: User; client: AdminClient; coachName(id: string | null | undefined): string; colorOf(id: string | null | undefined): string;
  onClose(): void; onChanged(): void; onBook(): void; onSwitch(): void;
}) {
  const [history, setHistory] = useState<{ history: Mark[]; package: { sessionsLeft: number; holdings: Holding[] } | null } | null>(null), [reload, setReload] = useState(0);
  const [adjusting, setAdjusting] = useState(false), [target, setTarget] = useState(""), [left, setLeft] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    coachFetch(user, `/api/admin/coaching-sessions?personId=${encodeURIComponent(client.id)}`).then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (active) setHistory(result);
    }).catch(() => { if (active) setError("Could not load the session history."); });
    return () => { active = false; };
  }, [user, client.id, reload]);
  async function act(body: Record<string, unknown>, done: string) {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await coachFetch(user, "/api/admin/coaching-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(ERRORS[(await response.json().catch(() => ({}))).error] ?? "Could not complete that. Reload and try again.");
      setMessage(done); setReload(v => v + 1); onChanged();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not complete that."); return false; }
    finally { setBusy(false); }
  }
  const next = client.next, holdings = history?.package?.holdings ?? [];
  const total = holdings.reduce((sum, row) => sum + row.sessions, 0), used = total - (history?.package?.sessionsLeft ?? 0);
  const nextLabel = next ? `${dateLabel(next.date, { weekday: "short" })} ${Number(next.date.slice(8))}, ${hourLabel(next.hour)}` : "Not booked";
  return <Sheet kicker={<><span className={s.dot} style={coachVar(colorOf(client.coachId))} aria-hidden="true" />{client.coachId ? `${coachName(client.coachId)}’s client` : "No coach yet"}</>} title={client.name} onClose={onClose}>
    {client.sessionsLeft === 1 && <p className={s.notice}>{next ? `Last session is booked for ${dateLabel(next.date, { weekday: "short", month: "short", day: "numeric" })} at ${hourLabel(next.hour)}.` : "One session left."} Remind {firstName(client.name)} to renew.</p>}
    <dl className={s.facts}>
      <div><dt>Sessions left</dt><dd className={s.factBig} style={{ color: client.sessionsLeft <= 1 ? "var(--rs-accent-text)" : undefined }}>{client.sessionsLeft}</dd></div>
      <div><dt>Coaching until</dt><dd>{client.frozen ? "Frozen" : until(client.coachingExpiresAt)}</dd></div>
      <div><dt>Next session</dt><dd>{nextLabel}</dd></div>
      <div><dt>Prefers</dt><dd>{client.preferredSchedule ? shortPreference(client).replace(/ (\w+)$/, " · $1") : "Not given"}</dd></div>
    </dl>
    <div className={s.threeActions}>
      <button type="button" className={`${s.button} ${s.primary}`} disabled={!bookableClient(client) || client.sessionsLeft - client.booked <= 0} onClick={onBook}>Book</button>
      <button type="button" className={s.button} onClick={onSwitch}>{client.coachId ? "Switch coach" : "Assign coach"}</button>
      <button type="button" className={s.button} aria-expanded={adjusting} disabled={!holdings.length} onClick={() => setAdjusting(v => !v)}>Adjust</button>
    </div>
    {adjusting && holdings.length > 0 && <div className={s.adjust}>
      {holdings.length > 1 && <label>Sessions to adjust<select value={target || holdings[0].id} onChange={event => setTarget(event.target.value)}>
        {holdings.map(row => <option key={row.id} value={row.id}>{row.topUp ? "Session top-ups" : "Coaching package"} · {row.sessionsLeft} left</option>)}</select></label>}
      <label>Sessions left<input inputMode="numeric" value={left} onChange={event => setLeft(event.target.value)} /></label>
      <label>Reason<input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" className={`${s.button} ${s.primary}`} disabled={busy || !left.trim() || !reason.trim()}
        onClick={() => void act({ action: "adjust", packageRecordId: target || holdings[0].id, sessionsLeft: Number(left), reason }, "Session adjustment saved.").then(ok => { if (ok) { setLeft(""); setReason(""); setAdjusting(false); } })}>Save adjustment</button>
    </div>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {message && <p className={s.notice} role="status">{message}</p>}
    <section className={s.history} aria-labelledby="client-history">
      <div className={s.sectionHead}><h3 id="client-history">Session history</h3>{total > 0 && <span>{used} of {total} used</span>}</div>
      {!history ? <p className={s.feedNote} style={{ marginTop: 0 }}>Loading…</p> : !history.history.length ? <p className={s.feedNote} style={{ marginTop: 0 }}>No sessions recorded yet.</p> :
        history.history.map(mark => <div key={mark.id} className={s.historyRow}>
          <span>{new Date(`${mark.date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric" })}</span>
          <span className={s.who}><span style={{ fontSize: 13, fontWeight: 500 }} data-tone={mark.outcome === "done" ? "success" : undefined}>{mark.outcome === "done" ? "✓ Session done" : "No-show"}</span>
            <span className={s.meta}>By {firstName(mark.coachName)}{mark.outcome === "no_show" ? " · no session used" : ""}{mark.note ? ` · ${mark.note}` : ""}</span></span>
          <span>
            <button type="button" className={s.link} disabled={busy} onClick={() => void act({ action: "fix", markId: mark.id, outcome: mark.outcome === "done" ? "no_show" : "done" }, "Mark corrected.")}>{mark.outcome === "done" ? "No-show" : "Done"}</button>
            <button type="button" className={`${s.link} ${s.dangerLink}`} disabled={busy} onClick={() => void act({ action: "undo", markId: mark.id }, "Mark undone.")}>Undo</button>
          </span>
        </div>)}
    </section>
  </Sheet>;
}

