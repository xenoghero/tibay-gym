"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addManilaDays } from "@/lib/coaching/clocks";
import { MAX_REPEAT_WEEKS, SLOT_HOURS, hourLabel, slotOf } from "@/lib/coaching/bookings";
import type { TimeSlot } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import { SLOT_NAMES, SLOT_RANGES, bookableClient, canMark, dateLabel, dayKey, firstName, preferenceText,
  type BookingState, type ScheduleBooking, type ScheduleClient, type ScheduleData } from "./schedule";
import s from "./schedule.module.css";

/** A modal <dialog>: a bottom sheet on phones, centred on desktops. Closing (Esc, backdrop, ×) calls onClose. */
export function Sheet({ title, kicker, onClose, children }: { title: string; kicker: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, []);
  return <dialog ref={ref} className={s.sheet} aria-labelledby="sheet-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className={s.sheetBody}>
      <div className={s.sheetHead}>
        <div><p>{kicker}</p><h2 id="sheet-title">{title}</h2></div>
        <button type="button" className={s.close} aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>
      {children}
    </div>
  </dialog>;
}

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];
const weekdayName = (date: string) => dateLabel(date, { weekday: "long" });
const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Starts at first session";

/** Book a client into a slot: hour chips, best-match clients first, optionally weekly. */
export function BookingSheet({ data, date, hour, personId, busy, error, onClose, onBook }: {
  data: ScheduleData; date: string; hour: number | null; personId?: string; busy: boolean; error: string; onClose(): void;
  onBook(body: { personId: string; date: string; hour: number; weeks: number }, done: string): void;
}) {
  const preset = data.clients.find(client => client.id === personId);
  const [day, setDay] = useState(date), [slot, setSlot] = useState<TimeSlot>(hour !== null ? slotOf(hour) : preset?.preferredSchedule?.timeSlot ?? "morning");
  const [chosenHour, setHour] = useState(hour), [chosen, setChosen] = useState(personId ?? null), [repeat, setRepeat] = useState(false);
  const bookings = data.bookings.filter(booking => booking.date === day), names = new Map(data.clients.map(client => [client.id, client.name]));
  const through = day < data.today ? 99 : day === data.today ? data.hourNow : -1, [first, end] = SLOT_HOURS[slot];
  const hours = Array.from({ length: end - first }, (_, i) => first + i).map(value => {
    const booked = bookings.find(booking => booking.hour === value);
    return { value, past: value <= through, who: booked ? names.get(booked.personId) ?? "Booked" : null };
  });
  const ranked = data.clients.map(client => {
    const spare = client.sessionsLeft - client.booked, pref = client.preferredSchedule, sameDay = bookings.find(booking => booking.personId === client.id);
    const match = !sameDay && !!pref && (pref.weekdays as string[]).includes(dayKey(day)) && pref.timeSlot === slot;
    const ok = bookableClient(client) && spare > 0;
    const note = client.frozen ? "Frozen · can’t be booked" : !bookableClient(client) ? "No sessions left · renew first" : spare <= 0 ? "Every session is already booked"
      : sameDay ? `Booked ${hourLabel(sameDay.hour)} that day` : match ? `✓ Prefers ${weekdayName(day)} ${SLOT_NAMES[slot].toLowerCase()}s` : preferenceText(client);
    return { client, spare, ok, match, note };
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.match) - Number(a.match) || Number(b.client.needsBooking) - Number(a.client.needsBooking) || a.client.name.localeCompare(b.client.name));
  const pick = ranked.find(row => row.client.id === chosen && row.ok);
  // Weekly up to the sessions not yet booked, 12 weeks, and the client's last coaching day.
  const lastDay = pick?.client.coachingExpiresAt ? philippineDate(pick.client.coachingExpiresAt - 1) : null;
  let weeks = 0;
  while (pick && weeks < Math.min(pick.spare, MAX_REPEAT_WEEKS) && (!lastDay || addManilaDays(day, weeks * 7) <= lastDay)) weeks++;
  const free = chosenHour !== null && !hours.find(row => row.value === chosenHour)?.who;
  const repeating = repeat && weeks > 1, ready = !!pick && free && weeks > 0;
  const label = !pick || chosenHour === null ? "Choose a time and client" : !free ? "That hour is taken" : repeating ? `Book ${weeks} ${weekdayName(day)}s` : `Book ${firstName(pick.client.name)} · ${hourLabel(chosenHour)}`;

  return <Sheet title="Book a session" kicker={`${dateLabel(day, { weekday: "short", month: "short", day: "numeric" })} · ${SLOT_NAMES[slot]}, ${SLOT_RANGES[slot]}`} onClose={onClose}>
    <label className={s.field}>Day<input type="date" value={day} min={data.today} onChange={event => { if (event.target.value) { setDay(event.target.value); setHour(null); } }} /></label>
    <div className={s.field}><span>Time slot</span>
      <div role="group" aria-label="Time slot" className={s.segmented}>
        {SLOTS.map(value => <button key={value} type="button" aria-pressed={slot === value} onClick={() => { setSlot(value); setHour(null); }}>{SLOT_NAMES[value]}</button>)}
      </div>
    </div>
    <div className={s.field}><span>Start time</span>
      <div className={s.chips}>{hours.map(({ value, past, who }) => <button key={value} type="button" disabled={past || !!who} aria-pressed={chosenHour === value} onClick={() => setHour(value)}>
        {hourLabel(value).replace(":00", "")}<small>{past ? "Past" : who ?? "Free"}</small>
      </button>)}</div>
    </div>
    <div className={s.field}><span>Client <span>· best match first</span></span>
      <ul className={s.picker}>{ranked.map(({ client, ok, match, note }) => <li key={client.id}>
        <button type="button" className={s.pick} disabled={!ok} aria-pressed={chosen === client.id} onClick={() => setChosen(client.id)}>
          <span className={s.avatar} aria-hidden="true">{client.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
          <span className={s.who}><strong>{client.name}</strong><span data-tone={match && ok ? "success" : undefined}>{note}</span></span>
          <span className={s.left}>{client.sessionsLeft}<small>LEFT</small></span>
        </button>
      </li>)}</ul>
    </div>
    {pick && chosenHour !== null && weeks > 1 && <label className={s.switchRow}>
      <span><span>Repeat every {weekdayName(day)}</span><span>{hourLabel(chosenHour)} through {dateLabel(addManilaDays(day, (weeks - 1) * 7), { month: "short", day: "numeric" })} · books {weeks} of {firstName(pick.client.name)}’s {pick.client.sessionsLeft} sessions</span></span>
      <input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} />
    </label>}
    {pick && weeks === 0 && <p className={s.error}>That day is after {firstName(pick.client.name)}’s coaching ends.</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.sheetActions}>
      <button type="button" className={s.button} onClick={onClose}>Cancel</button>
      <button type="button" className={`${s.button} ${s.primary}`} disabled={!ready || busy} onClick={() => pick && chosenHour !== null && onBook({ personId: pick.client.id, date: day, hour: chosenHour, weeks: repeating ? weeks : 1 },
        repeating ? `Booked ${pick.client.name} every ${weekdayName(day)} at ${hourLabel(chosenHour)} (${weeks} sessions).` : `Booked ${pick.client.name} on ${dateLabel(day, { weekday: "short", month: "short", day: "numeric" })} at ${hourLabel(chosenHour)}.`)}>
        {busy ? "Booking…" : label}
      </button>
    </div>
  </Sheet>;
}

/** One booking: mark it once it starts, or cancel it while unmarked. */
export function BookingDetail({ booking, client, state, busy, error, onClose, onMark, onCancel }: {
  booking: ScheduleBooking; client: ScheduleClient | undefined; state: BookingState; busy: boolean; error: string; onClose(): void; onMark(outcome: "done" | "no_show"): void; onCancel(): void;
}) {
  const name = client?.name ?? "Former client", markHere = canMark(state);
  return <Sheet title={name} kicker={`${dateLabel(booking.date, { weekday: "short", month: "short", day: "numeric" })} · ${hourLabel(booking.hour)}–${hourLabel(booking.hour + 1)}`} onClose={onClose}>
    {state === "booked" && client?.sessionsLeft === 1 && <p className={s.notice}>Last session. After it, {firstName(name)} has 0 left — remind them to renew at the front desk.</p>}
    {booking.mark && <p className={s.notice} role="status">{booking.mark.outcome === "done" ? "✓ Session done." : "No-show recorded. No session was used."} To undo, open the client under Clients.</p>}
    {client && <dl className={s.facts}>
      <div><dt>Sessions left</dt><dd style={{ font: "600 28px/1 var(--font-barlow-condensed), sans-serif", color: client.sessionsLeft <= 1 ? "var(--rs-accent-text)" : undefined }}>{client.sessionsLeft}</dd></div>
      <div><dt>Coaching until</dt><dd>{until(client.coachingExpiresAt)}</dd></div>
      <div className={s.wide}><dt>Preferred schedule</dt><dd>{preferenceText(client).replace(/^Prefers /, "")}</dd></div>
      {booking.seriesId && <div className={s.wide}><dt>Repeats</dt><dd>Every {weekdayName(booking.date)} at {hourLabel(booking.hour)}</dd></div>}
    </dl>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {(markHere || !booking.mark) && <div className={s.actionList}>
      {markHere && <>
        <button type="button" className={`${s.button} ${s.primary}`} disabled={busy} onClick={() => onMark("done")}>✓ Mark session done</button>
        <button type="button" className={s.button} disabled={busy} onClick={() => onMark("no_show")}>Record no-show <span className={s.tone}>· doesn’t use a session</span></button>
      </>}
      {state === "booked" && <p className={s.feedNote} style={{ margin: 0 }}>You can mark it done once it starts.</p>}
      {!booking.mark && <button type="button" className={`${s.button} ${s.danger}`} style={{ marginTop: 8 }} disabled={busy} onClick={onCancel}>Cancel booking</button>}
    </div>}
  </Sheet>;
}
