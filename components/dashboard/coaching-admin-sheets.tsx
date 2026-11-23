"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { addManilaDays } from "@/lib/coaching/clocks";
import { SLOT_HOURS, shortTime, timeLabel } from "@/lib/coaching/bookings";
import { coachFetch } from "@/app/coach/coach-clients";
import { bookableClient, dateLabel, dayKey, firstName, muscleText } from "@/app/coach/schedule";
import { SLOT_NAMES, coachVar, shortPreference, type AdminClient, type AdminData } from "./coaching-admin";
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

const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Starts at first session";

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
    const busyDay = wanted.map(date => ({ date, rows: data.bookings.filter(booking => booking.coachId === coachId && booking.date === date && booking.start < end * 60 && booking.start + booking.minutes > first * 60) }))
      .find(row => row.rows.length);
    const label = pref.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(" & ");
    if (!busyDay) return { good: true, text: `✓ Free ${label} ${SLOT_NAMES[pref.timeSlot].toLowerCase()}s` };
    const low = Math.min(...busyDay.rows.map(row => row.start)), high = Math.max(...busyDay.rows.map(row => row.start + row.minutes));
    return { good: false, text: `Busy ${dateLabel(busyDay.date, { weekday: "short" })} ${shortTime(low)}–${shortTime(high)}` };
  };
  const coach = data.coaches.find(row => row.id === chosen), weekEnd = days[6];
  return <Sheet kicker={`${client.name} · ${client.sessionsLeft} sessions · ${shortPreference(client)}`} title={client.coachId ? "Switch coach" : "Assign a coach"} onClose={onClose}>
    {client.coachId && <p className={s.notice}>Now with {client.coachName}. Sessions already done stay credited to them. Upcoming sessions move to the new coach; any that clash with the new coach’s sessions are cancelled.</p>}
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

interface Mark { id: string; date: string; outcome: "done" | "no_show"; note: string | null; coachName: string; start: number | null; muscles: string[]; exercisesDone: number; exercisesTotal: number }
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
  const nextLabel = next ? `${dateLabel(next.date, { weekday: "short" })} ${Number(next.date.slice(8))}, ${timeLabel(next.start)}` : "Not booked";
  return <Sheet kicker={<><span className={s.dot} style={coachVar(colorOf(client.coachId))} aria-hidden="true" />{client.coachId ? `${coachName(client.coachId)}’s client` : "No coach yet"}</>} title={client.name} onClose={onClose}>
    {client.sessionsLeft === 1 && <p className={s.notice}>{next ? `Last session is booked for ${dateLabel(next.date, { weekday: "short", month: "short", day: "numeric" })} at ${timeLabel(next.start)}.` : "One session left."} Remind {firstName(client.name)} to renew.</p>}
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
            <span className={s.meta}>By {firstName(mark.coachName)}{mark.start !== null ? ` · ${timeLabel(mark.start)}` : ""}{mark.muscles.length ? ` · ${muscleText(mark.muscles)}` : ""}{mark.exercisesTotal ? ` · ${mark.exercisesDone} of ${mark.exercisesTotal} exercises` : ""}{mark.outcome === "no_show" ? " · no session used" : ""}{mark.note ? ` · ${mark.note}` : ""}</span></span>
          <span>
            <button type="button" className={s.link} disabled={busy} onClick={() => void act({ action: "fix", markId: mark.id, outcome: mark.outcome === "done" ? "no_show" : "done" }, "Mark corrected.")}>{mark.outcome === "done" ? "No-show" : "Done"}</button>
            <button type="button" className={`${s.link} ${s.dangerLink}`} disabled={busy} onClick={() => void act({ action: "undo", markId: mark.id }, "Mark undone.")}>Undo</button>
          </span>
        </div>)}
    </section>
  </Sheet>;
}

