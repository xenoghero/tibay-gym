"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { addManilaDays } from "@/lib/coaching/clocks";
import { DAY_END, DAY_START, DURATIONS, MAX_REPEAT_WEEKS, MUSCLES, SLOT_HOURS, START_TIMES, overlaps, slotOf, timeLabel, type Exercise, type Muscle } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import { bookableClient, canMark, dateLabel, dayKey, firstName, initials,
  type BookingState, type ScheduleBooking, type ScheduleClient, type ScheduleData } from "./schedule";
import s from "./schedule.module.css";

/** A modal <dialog>: a bottom sheet on phones, centred on desktops. Closing (Esc, backdrop, ×) calls onClose. */
export function Sheet({ title, kicker, top, footer, onClose, children }: { title: string; kicker?: ReactNode; top?: ReactNode; footer?: ReactNode; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.(); }, []);
  return <dialog ref={ref} className={s.sheet} aria-labelledby="sheet-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className={s.sheetBody}>
      <div className={s.sheetHead}>
        <div className={s.sheetHeadText}>{top}{kicker && <p className={s.kicker}>{kicker}</p>}<h2 id="sheet-title">{title}</h2></div>
        <button type="button" className={s.close} aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </div>
      {children}
    </div>
    {footer && <div className={s.sheetFoot}>{footer}</div>}
  </dialog>;
}

interface Shared {
  data: ScheduleData; admin: boolean; busy: boolean; error: string; onClose(): void;
  nameOf(id: string): string; coachName(id: string | null | undefined): string; badge(id: string): CSSProperties; state(booking: ScheduleBooking): BookingState;
}
type Send = (body: Record<string, unknown>, done: string) => Promise<Record<string, unknown> | null>;
const range = (booking: { start: number; minutes: number }) => `${timeLabel(booking.start)}–${timeLabel(booking.start + booking.minutes)}`;
const longDate = (date: string) => dateLabel(date, { weekday: "long", month: "short", day: "numeric" });
const shortDate = (date: string) => dateLabel(date, { weekday: "short", month: "short", day: "numeric" });
const STATUS: Record<BookingState, string> = { done: "✓ Done", no_show: "No-show", due: "Ended · mark it", live: "In session · mark when done", unmarked: "Not marked", booked: "" };

/** One day: its sessions by start time, each with its plan and status, and Add session. */
export function DaySheet({ data, admin, date, list, nameOf, coachName, badge, state, onClose, onOpen, onAdd }: Shared & { date: string; list: ScheduleBooking[]; onOpen(id: string): void; onAdd(): void }) {
  const due = list.filter(row => canMark(state(row))).length, clients = new Map(data.clients.map(client => [client.id, client]));
  const tooOld = !admin && date < addManilaDays(data.today, -30);
  const kicker = [date === data.today && "Today", `${list.length} session${list.length === 1 ? "" : "s"}`, admin && list.length && `${new Set(list.map(row => row.coachId)).size} coach${new Set(list.map(row => row.coachId)).size === 1 ? "" : "es"}`,
    due && `${due} to mark`].filter(Boolean).join(" · ");
  return <Sheet title={longDate(date)} kicker={kicker} onClose={onClose}>
    {!tooOld && <button type="button" className={`${s.button} ${s.primary} ${s.wide}`} onClick={onAdd}><span>Add session</span><span aria-hidden="true">+</span></button>}
    {!list.length && <p className={s.feedNote}>{tooOld ? "No sessions. Days older than 30 days can only be changed by the admin." : "No sessions yet."}</p>}
    <div className={s.cards}>{list.map(row => {
      const st = state(row), client = clients.get(row.personId), done = row.exercises.filter(item => item.done).length;
      const status = STATUS[st] || (client?.sessionsLeft === 1 ? "Last session" : client ? `${client.sessionsLeft} left` : "");
      return <button key={row.id} type="button" className={s.sessionCard} data-state={st} onClick={() => onOpen(row.id)}>
        <span className={s.cardTop}><time>{range(row)}</time><span className={s.status} data-state={st}>{status}</span></span>
        <span className={s.cardName}>{nameOf(row.personId)}{admin && <span className={s.coachTag}><span className={s.badge} style={badge(row.coachId)} aria-hidden="true">{initials(coachName(row.coachId))[0]}</span>{firstName(coachName(row.coachId))}</span>}</span>
        <span className={s.cardMeta}>{row.muscles.map(item => <span key={item} className={s.muscle}>{item}</span>)}
          <span>{row.exercises.length ? `${done} of ${row.exercises.length} exercises` : "No exercises yet"}</span></span>
        {row.exercises.length > 0 && <span className={s.progress} aria-hidden="true"><span style={{ width: `${done / row.exercises.length * 100}%` }} /></span>}
      </button>;
    })}</div>
  </Sheet>;
}

/** "3 × 10 · 35 kg" when every set matches, else "3 sets". */
const setSummary = (exercise: Exercise) => {
  const sets = exercise.sets, [first] = sets;
  if (!sets.length) return "No sets";
  if (sets.every(set => set.reps === first.reps && set.kg === first.kg) && (first.reps !== null || first.kg !== null))
    return `${sets.length} × ${first.reps ?? "–"}${first.kg !== null ? ` · ${first.kg} kg` : ""}`;
  return `${sets.length} set${sets.length === 1 ? "" : "s"}`;
};
const num = (value: string) => value === "" ? null : Number(value);
const SHOWN = 10;

/**
 * One session: step through the day's sessions, set target muscles, keep the Exercise checklist with sets, write a note,
 * then mark it done or a No-show (ticks are only a record). The time can change while unmarked; the admin can change anything.
 */
export function SessionSheet({ data, admin, busy, error, booking, siblings, nameOf, coachName, badge, state, onClose, onOpen, onBack, onSend, onMark, onFix }: Shared & {
  booking: ScheduleBooking; siblings: ScheduleBooking[]; onOpen(id: string): void; onBack(): void; onSend: Send; onMark: Send; onFix: Send;
}) {
  const [muscles, setMuscles] = useState<Muscle[]>(booking.muscles), [exercises, setExercises] = useState<Exercise[]>(booking.exercises), [note, setNote] = useState(booking.note ?? "");
  const [expanded, setExpanded] = useState<number | null>(booking.exercises.length ? 0 : null), [all, setAll] = useState(false), [name, setName] = useState("");
  const [picking, setPicking] = useState(false), [timing, setTiming] = useState(false);
  const [day, setDay] = useState(booking.date), [start, setStart] = useState(booking.start), [length, setLength] = useState(booking.minutes);
  const st = state(booking), client = data.clients.find(row => row.id === booking.personId), clientName = nameOf(booking.personId);
  const editable = admin || booking.date >= addManilaDays(data.today, -30);
  const plan = { muscles, exercises, note: note.trim() || null };
  const dirty = JSON.stringify(plan) !== JSON.stringify({ muscles: booking.muscles, exercises: booking.exercises, note: booking.note });
  const index = siblings.findIndex(row => row.id === booking.id), prev = siblings[index - 1], next = siblings[index + 1];
  const done = exercises.filter(item => item.done).length;
  const mine = booking.mark && (admin || (booking.mark.coachId === booking.coachId && philippineDate(booking.mark.createdAt) === data.today));
  const change = (at: number, next: Partial<Exercise>) => setExercises(rows => rows.map((row, i) => i === at ? { ...row, ...next } : row));
  const save = () => onSend({ action: "update", bookingId: booking.id, ...plan }, "Session saved.");
  async function mark(outcome: "done" | "no_show") {
    if (dirty && !(await save())) return;
    await onMark({ action: "mark", personId: booking.personId, outcome, bookingId: booking.id, operationId: crypto.randomUUID() },
      outcome === "done" ? `${firstName(clientName)}’s session is marked done.` : "No-show recorded. No session was used.");
  }
  const undo = () => (admin ? onFix : onMark)({ action: "undo", markId: booking.mark!.id }, "Mark undone. The session is open again.");
  function addExercise() {
    const value = name.trim();
    if (!value) return;
    setExercises(rows => [...rows, { name: value.slice(0, 80), done: false, sets: [] }]); setExpanded(exercises.length); setName("");
    if (exercises.length >= SHOWN) setAll(true);
  }

  const top = <div className={s.sheetTop}>
    <button type="button" className={s.link} onClick={onBack}>‹ {shortDate(booking.date)}</button>
    {siblings.length > 1 && <div role="group" aria-label="Sessions this day" className={s.stepper}>
      <button type="button" aria-label={prev ? `Previous: ${nameOf(prev.personId)}, ${timeLabel(prev.start)}` : "No earlier session"} disabled={!prev} onClick={() => prev && onOpen(prev.id)}>‹</button>
      <span>{index + 1} / {siblings.length}</span>
      <button type="button" aria-label={next ? `Next: ${nameOf(next.personId)}, ${timeLabel(next.start)}` : "No later session"} disabled={!next} onClick={() => next && onOpen(next.id)}>›</button>
    </div>}
  </div>;
  const footer = <>
    {error && <p className={s.error} role="alert">{error}</p>}
    {dirty && editable && <button type="button" className={`${s.button} ${canMark(st) ? "" : s.primary} ${s.wide}`} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>}
    {canMark(st) && <>
      <button type="button" className={`${s.button} ${s.primary} ${s.wide} ${s.big}`} disabled={busy} onClick={() => void mark("done")}><span>Mark session done</span><span aria-hidden="true">✓</span></button>
      <button type="button" className={s.button} disabled={busy} onClick={() => void mark("no_show")}>No-show <span className={s.tone}>· doesn’t use a session</span></button>
    </>}
    {st === "booked" && <p className={s.feedNote}>You can mark it once it starts at {timeLabel(booking.start)}.</p>}
    {st === "unmarked" && <p className={s.feedNote}>Not marked. Sessions older than 30 days can only be marked by the admin.</p>}
    {booking.mark && <div className={s.markRow}>
      <span className={s.status} data-state={booking.mark.outcome}>{booking.mark.outcome === "done" ? "✓ Session done" : "No-show · no session used"}</span>
      {admin && <button type="button" className={s.link} disabled={busy} onClick={() => void onFix({ action: "fix", markId: booking.mark!.id, outcome: booking.mark!.outcome === "done" ? "no_show" : "done" }, "Mark changed.")}>
        Change to {booking.mark.outcome === "done" ? "No-show" : "Done"}</button>}
      {mine && <button type="button" className={s.link} disabled={busy} onClick={() => void undo()}>Undo</button>}
    </div>}
  </>;

  return <Sheet title={clientName} top={top} footer={footer} onClose={onClose}>
    <p className={s.timeLine}>{range(booking)} · {booking.minutes} min{admin && <> · <span className={s.badge} style={badge(booking.coachId)} aria-hidden="true">{initials(coachName(booking.coachId))[0]}</span> {coachName(booking.coachId)}</>}</p>
    {st === "booked" && client?.sessionsLeft === 1 && <p className={s.notice}>Last session. Remind {firstName(clientName)} to renew.</p>}

    <div className={s.muscleRow}>
      {(picking ? MUSCLES : muscles).map(item => <button key={item} type="button" className={s.muscleChip} aria-pressed={muscles.includes(item)} disabled={!editable}
        onClick={() => setMuscles(rows => rows.includes(item) ? rows.filter(row => row !== item) : MUSCLES.filter(row => row === item || rows.includes(row)))}>{item}</button>)}
      {editable && <button type="button" className={s.muscleAdd} aria-expanded={picking} onClick={() => setPicking(v => !v)}>{picking ? "Done" : muscles.length ? "Edit muscles" : "+ Target muscles"}</button>}
    </div>

    <div className={s.sectionHead}><span>Exercises</span><span>{exercises.length ? `${done} of ${exercises.length} done` : "None yet"}</span></div>
    <ul className={s.exercises}>{exercises.slice(0, all ? undefined : SHOWN).map((item, at) => <li key={at} className={s.exercise}>
      <div className={s.exerciseHead}>
        <input type="checkbox" aria-label={`${item.name} done`} checked={item.done} disabled={!editable} onChange={event => change(at, { done: event.target.checked })} />
        <button type="button" className={s.exerciseName} aria-expanded={expanded === at} onClick={() => setExpanded(expanded === at ? null : at)} data-done={item.done || undefined}>{item.name}</button>
        <span className={s.setSummary}>{setSummary(item)}</span>
      </div>
      {expanded === at && <div className={s.setTable}>
        {item.sets.length > 0 && <div className={s.setRow} aria-hidden="true"><span>Set</span><span>Reps</span><span>Kg</span><span /></div>}
        {item.sets.map((set, n) => <div key={n} className={s.setRow}>
          <span>{n + 1}</span>
          <input type="number" inputMode="numeric" min={0} max={1000} step={1} aria-label={`${item.name} set ${n + 1} reps`} value={set.reps ?? ""} disabled={!editable}
            onChange={event => change(at, { sets: item.sets.map((row, i) => i === n ? { ...row, reps: num(event.target.value) } : row) })} />
          <input type="number" inputMode="decimal" min={0} max={1000} step={0.25} aria-label={`${item.name} set ${n + 1} kg`} value={set.kg ?? ""} disabled={!editable}
            onChange={event => change(at, { sets: item.sets.map((row, i) => i === n ? { ...row, kg: num(event.target.value) } : row) })} />
          {editable ? <button type="button" className={s.remove} aria-label={`Remove set ${n + 1}`} onClick={() => change(at, { sets: item.sets.filter((_, i) => i !== n) })}>×</button> : <span />}
        </div>)}
        {editable && <div className={s.setActions}>
          {item.sets.length < 20 && <button type="button" className={s.link} onClick={() => change(at, { done: true, sets: [...item.sets, item.sets.at(-1) ?? { reps: null, kg: null }] })}>+ Add set</button>}
          <button type="button" className={`${s.link} ${s.dangerLink}`} onClick={() => { setExercises(rows => rows.filter((_, i) => i !== at)); setExpanded(null); }}>Remove exercise</button>
        </div>}
      </div>}
    </li>)}</ul>
    {exercises.length > SHOWN && <button type="button" className={s.link} onClick={() => setAll(v => !v)}>{all ? "Show fewer" : `Show all ${exercises.length} exercises`}</button>}
    {editable && exercises.length < 100 && <div className={s.addRow}>
      <input aria-label="New exercise" placeholder="Add an exercise" maxLength={80} value={name} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addExercise(); } }} />
      <button type="button" className={s.button} disabled={!name.trim()} onClick={addExercise}>Add</button>
    </div>}

    <label className={s.field}><span className={s.label}>Note <span>· {firstName(clientName)} sees this</span></span>
      <textarea rows={2} maxLength={500} placeholder="How did it go?" value={note} disabled={!editable} onChange={event => setNote(event.target.value)} /></label>

    {(admin || (!booking.mark && editable)) && <div className={s.moreActions}>
      <button type="button" className={s.link} aria-expanded={timing} onClick={() => setTiming(v => !v)}>Change day or time</button>
      {!booking.mark && <button type="button" className={`${s.link} ${s.dangerLink}`} disabled={busy} onClick={() => void onSend({ action: "cancel", bookingId: booking.id }, "Session cancelled.").then(ok => { if (ok) onBack(); })}>Cancel session</button>}
    </div>}
    {timing && <div className={s.timeEdit}>
      <label className={s.field}><span className={s.label}>Day</span><input type="date" value={day} min={admin ? undefined : addManilaDays(data.today, -30)} onChange={event => event.target.value && setDay(event.target.value)} /></label>
      <TimeFields start={start} minutes={length} onStart={setStart} onMinutes={setLength} />
      <button type="button" className={`${s.button} ${s.primary}`} disabled={busy || (day === booking.date && start === booking.start && length === booking.minutes)}
        onClick={() => void onSend({ action: "update", bookingId: booking.id, date: day, start, minutes: length }, "Session moved.").then(ok => { if (ok) setTiming(false); })}>Save time</button>
    </div>}
  </Sheet>;
}

/** Start (every 15 minutes) and length pickers; lengths that would run past 10 PM are left out. */
function TimeFields({ start, minutes, onStart, onMinutes }: { start: number; minutes: number; onStart(value: number): void; onMinutes(value: number): void }) {
  return <div className={s.twoFields}>
    <label className={s.field}><span className={s.label}>Start</span>
      <select value={start} onChange={event => { const value = Number(event.target.value); onStart(value); if (value + minutes > DAY_END) onMinutes(DURATIONS.filter(row => value + row <= DAY_END).at(-1)!); }}>
        {START_TIMES.map(value => <option key={value} value={value}>{timeLabel(value)}</option>)}</select></label>
    <label className={s.field}><span className={s.label}>Length</span>
      <select value={minutes} onChange={event => onMinutes(Number(event.target.value))}>
        {DURATIONS.filter(value => start + value <= DAY_END).map(value => <option key={value} value={value}>{value} min</option>)}</select></label>
  </div>;
}

/**
 * Add a session: the client first (best matches on top, ones who can't be added greyed out with why), then start and length,
 * target muscles and an optional weekly repeat. The admin also picks the coach (the client's own, or any coach for an unassigned client).
 */
export function AddSheet({ data, admin, busy, error, date, personId, coachId: presetCoach, nameOf, coachName, badge, onClose, onBack, onAdd }: Shared & {
  date: string; personId?: string; coachId?: string; onBack(): void;
  onAdd(body: { personId: string; coachId?: string; date: string; start: number; minutes: number; muscles: Muscle[]; weeks: number }, done: string): void;
}) {
  const { today, minuteNow } = data, coaches = data.coaches ?? [];
  const [day, setDay] = useState(date), [chosen, setChosen] = useState(personId ?? null), [query, setQuery] = useState("");
  const [start, setStart] = useState<number | null>(null), [length, setLength] = useState(60), [muscles, setMuscles] = useState<Muscle[]>([]), [repeat, setRepeat] = useState(false);
  const [pickedCoach, setCoach] = useState(presetCoach ?? ""), [listing, setListing] = useState(false);
  const client = data.clients.find(row => row.id === chosen);
  // A coach's schedule holds only their own sessions, so every one of them counts as the coach's.
  const coachId = admin ? client?.coachId ?? (pickedCoach || coaches[0]?.id) : null;
  const onDay = data.bookings.filter(row => row.date === day);
  const clashOf = (at: number, minutes: number, id: string | null) => onDay.find(row => (!admin || row.coachId === coachId || row.personId === id) && overlaps(row, { date: day, start: at, minutes }));
  // A sensible first time: the client's preferred slot when given, never one already past today, and free for the coach and client.
  const earliest = day === today ? Math.ceil((minuteNow + 1) / 15) * 15 : DAY_START;
  const suggest = (target: ScheduleClient | undefined) => {
    const pref = target?.preferredSchedule, [low, high] = pref ? SLOT_HOURS[pref.timeSlot] : [7, 22];
    const options = START_TIMES.filter(value => value + length <= DAY_END && (day < today || value >= earliest));
    return options.find(value => value >= low * 60 && value < high * 60 && !clashOf(value, length, target?.id ?? null)) ?? options.find(value => !clashOf(value, length, target?.id ?? null)) ?? options[0] ?? DAY_START;
  };
  const at = start ?? suggest(client);
  const past = day < today;
  const ranked = data.clients.map(row => {
    const spare = row.sessionsLeft - row.booked, pref = row.preferredSchedule, sameDay = onDay.find(other => other.personId === row.id);
    const match = !sameDay && !!pref && (pref.weekdays as string[]).includes(dayKey(day)) && pref.timeSlot === slotOf(at);
    const ok = bookableClient(row) && (past || spare > 0);
    const why = row.frozen ? "Frozen · can’t be added" : !bookableClient(row) ? "No sessions left · renew first" : !ok ? "Every session is already booked"
      : sameDay ? `Already has ${timeLabel(sameDay.start)} that day` : match ? `✓ Prefers ${dateLabel(day, { weekday: "short" })} ${pref!.timeSlot}s`
      : pref ? `Prefers ${pref.weekdays.map(value => value[0].toUpperCase() + value.slice(1)).join(", ")} · ${pref.timeSlot}s` : "No preferred schedule";
    return { row, spare, ok, match, why: admin ? `${row.coachName ? firstName(row.coachName) : "No coach yet"} · ${why}` : why };
  }).filter(({ row }) => !query.trim() || row.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.match) - Number(a.match) || a.row.name.localeCompare(b.row.name));
  const pick = ranked.find(entry => entry.row.id === chosen && entry.ok);
  const lastDay = pick?.row.coachingExpiresAt ? philippineDate(pick.row.coachingExpiresAt - 1) : null;
  let weeks = 0;
  while (pick && weeks < (past ? 1 : Math.min(pick.spare, MAX_REPEAT_WEEKS)) && (!lastDay || addManilaDays(day, weeks * 7) <= lastDay)) weeks++;
  const clash = clashOf(at, length, chosen), repeating = repeat && weeks > 1;
  const who = admin ? coachName(coachId) : "you";
  const ready = !!pick && (!admin || !!coachId) && !clash && weeks > 0 && (past || day > today || at >= earliest);
  const label = !pick ? "Choose a client" : clash ? "That time is taken" : weeks === 0 ? "After their coaching ends"
    : repeating ? `Add ${weeks} ${dateLabel(day, { weekday: "long" })}s` : `Add ${firstName(pick.row.name)} · ${timeLabel(at)}`;
  const pickClient = (row: ScheduleClient) => { setChosen(row.id); if (row.coachId) setCoach(row.coachId); setListing(false); setQuery(""); };

  return <Sheet title="Add session" top={<button type="button" className={s.link} onClick={onBack}>‹ {shortDate(day)}</button>} onClose={onClose}
    footer={<>
      {error && <p className={s.error} role="alert">{error}</p>}
      <button type="button" className={`${s.button} ${s.primary} ${s.wide} ${s.big}`} disabled={!ready || busy}
        onClick={() => pick && onAdd({ personId: pick.row.id, ...(admin && coachId ? { coachId } : {}), date: day, start: at, minutes: length, muscles, weeks: repeating ? weeks : 1 },
          repeating ? `Added ${pick.row.name} every ${dateLabel(day, { weekday: "long" })} at ${timeLabel(at)} (${weeks} sessions).` : `Added ${pick.row.name} on ${shortDate(day)} at ${timeLabel(at)}.`)}>
        <span>{busy ? "Adding…" : label}</span><span aria-hidden="true">✓</span></button>
    </>}>
    <div className={s.field}>
      <span className={s.label} id="add-client-label">Client</span>
      <button type="button" className={s.select} aria-labelledby="add-client-label add-client-value" aria-expanded={listing} aria-controls="add-client-list" onClick={() => setListing(v => !v)}>
        {pick ? <span id="add-client-value" className={s.who}><strong>{pick.row.name}</strong><span data-tone={pick.match ? "success" : undefined}>{pick.why}</span></span>
          : <span id="add-client-value" className={s.placeholder}>Search or pick a client</span>}
        {pick && <span className={s.left}>{pick.row.sessionsLeft}<small>left</small></span>}
        <span className={s.caret} aria-hidden="true">▾</span>
      </button>
      {listing && <div id="add-client-list" className={s.dropdown}>
        <input type="search" className={s.search} aria-label="Search clients" placeholder="Search clients" autoFocus value={query} onChange={event => setQuery(event.target.value)} />
        <div role="radiogroup" aria-label="Clients" className={s.picker}>{ranked.map(({ row, ok, match, why }) => <label key={row.id} className={s.pick} data-disabled={!ok || undefined}>
          <input type="radio" name="add-client" checked={chosen === row.id} disabled={!ok} onChange={() => pickClient(row)} />
          <span className={s.who}><strong>{row.name}</strong><span data-tone={match && ok ? "success" : undefined}>{why}</span></span>
          <span className={s.left}>{row.sessionsLeft}<small>left</small></span>
        </label>)}
          {!ranked.length && <p className={s.feedNote}>No clients match.</p>}</div>
      </div>}
    </div>

    {admin && <div className={s.field}><span className={s.label}>Coach {client && <span>· {client.coachId ? `${firstName(client.name)}’s coach` : `adding assigns them to ${firstName(client.name)}`}</span>}</span>
      <div role="radiogroup" aria-label="Coach" className={s.options}>{coaches.map(row => <button key={row.id} type="button" role="radio" aria-checked={coachId === row.id} className={s.chip}
        disabled={!!client?.coachId && client.coachId !== row.id} onClick={() => setCoach(row.id)}>
        <span className={s.badge} style={badge(row.id)} aria-hidden="true">{initials(row.name)[0]}</span>{row.name}</button>)}</div>
      {!coaches.length && <p className={s.error}>Create a coach in Settings → Coaching first.</p>}
    </div>}

    <label className={s.field}><span className={s.label}>Day {past && <span>· a past day records a walk-in</span>}</span>
      <input type="date" value={day} min={admin ? undefined : addManilaDays(today, -30)} onChange={event => { if (event.target.value) { setDay(event.target.value); setStart(null); } }} /></label>
    <TimeFields start={at} minutes={length} onStart={setStart} onMinutes={value => { setLength(value); if (start === null) setStart(at); }} />
    {pick && <p className={s.freeLine} data-tone={clash ? "danger" : "success"}>{!clash ? `✓ Free ${range({ start: at, minutes: length })} for ${who} and ${firstName(pick.row.name)}`
      : clash.personId === chosen ? `${firstName(pick.row.name)} already has a session at ${range(clash)}`
      : `${admin ? `${firstName(coachName(coachId))} has` : "You have"} ${firstName(nameOf(clash.personId))} at ${range(clash)}`}</p>}

    <fieldset className={s.fieldset}>
      <legend className={s.label}>Target muscles <span>· optional</span></legend>
      <div className={s.muscleRow}>{MUSCLES.map(item => <button key={item} type="button" className={s.muscleChip} aria-pressed={muscles.includes(item)}
        onClick={() => setMuscles(rows => rows.includes(item) ? rows.filter(row => row !== item) : MUSCLES.filter(row => row === item || rows.includes(row)))}>{item}</button>)}</div>
    </fieldset>

    {pick && weeks > 1 && <label className={s.switchRow}>
      <span><span>Repeat every {dateLabel(day, { weekday: "long" })}</span><span>{timeLabel(at)} through {dateLabel(addManilaDays(day, (weeks - 1) * 7), { month: "short", day: "numeric" })} · {weeks} of {firstName(pick.row.name)}’s {pick.row.sessionsLeft} sessions · exercises added each week</span></span>
      <input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} />
    </label>}
  </Sheet>;
}
