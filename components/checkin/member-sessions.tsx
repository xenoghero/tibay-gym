"use client";

import { useEffect, useState } from "react";
import { timeLabel, type Exercise, type WorkSet } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import { Sheet } from "@/app/coach/booking-sheet";
import { dateLabel, firstOfMonth } from "@/app/coach/schedule";
import styles from "./customer-access.module.css";
import own from "./member-sessions.module.css";

interface Session { id: string; date: string; start: number | null; minutes: number | null; coachName: string; outcome: "done" | "no_show" | null; started: boolean; muscles: string[]; exercises: Exercise[]; note: string | null }
interface Month { month: string; today: string; sessions: Session[]; next: { date: string; start: number; end: number; coachName: string; muscles: string[] } | null }
type Kind = "done" | "no_show" | "next" | "upcoming" | "unmarked";

const title = (session: Session) => session.muscles.length ? session.muscles.join(", ") : session.start === null ? "Recorded" : "Coaching session";
const setText = (set: WorkSet) => set.reps !== null && set.kg !== null ? `${set.reps} × ${set.kg} kg` : set.reps !== null ? `${set.reps} reps` : set.kg !== null ? `${set.kg} kg` : "Set";

/**
 * The member's Coaching sessions, one month at a time: a card for each session (done, No-show, the next one, coming up),
 * and a read-only sheet with what they did — each exercise with its sets — and the coach's note.
 */
export function MemberSessions({ sessionsLeft, sessions: total }: { sessionsLeft: number; sessions: number | null }) {
  const [month, setMonth] = useState<string | null>(null), [data, setData] = useState<Month | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Session | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/customer/coaching?month=${(month ?? philippineDate(Date.now())).slice(0, 7)}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); setData(await response.json()); setError(""); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load your sessions. Try again."); });
    return () => controller.abort();
  }, [month, reload]);

  const shown = month ?? (data ? `${data.month}-01` : null);
  const kind = (session: Session): Kind => session.outcome
    ?? (data?.next && session.date === data.next.date && session.start === data.next.start ? "next" : session.started ? "unmarked" : "upcoming");
  const sessions = data?.sessions ?? [];
  const counts = { done: sessions.filter(row => row.outcome === "done").length, missed: sessions.filter(row => row.outcome === "no_show").length,
    coming: sessions.filter(row => !row.outcome && (kind(row) === "next" || kind(row) === "upcoming")).length };

  return <section className={styles.paymentPanel} aria-labelledby="my-sessions">
    <div className={styles.sectionHeading}><h2 id="my-sessions">My sessions</h2></div>
    {data?.next && <p className={own.next}><span aria-hidden="true" />Next: <strong>{dateLabel(data.next.date, { weekday: "short", month: "short", day: "numeric" })} · {timeLabel(data.next.start)}</strong> · Coach {data.next.coachName}</p>}
    <div className={own.monthBar}>
      <button type="button" aria-label="Previous month" disabled={!shown} onClick={() => shown && setMonth(firstOfMonth(shown, -1))}>‹</button>
      <span aria-live="polite">{shown ? dateLabel(shown, { month: "long", year: "numeric" }) : "…"}</span>
      <button type="button" aria-label="Next month" disabled={!shown} onClick={() => shown && setMonth(firstOfMonth(shown, 1))}>›</button>
    </div>
    {error ? <div className={own.error}><p role="alert">{error}</p><button type="button" className={styles.secondaryButton} onClick={() => setReload(v => v + 1)}>Retry</button></div>
      : !data ? <p className={own.muted}>Loading…</p> : <>
        <p className={own.counts}>
          <span data-tone="success"><strong>{counts.done}</strong> done</span><span><strong>{counts.missed}</strong> no-show</span>
          <span data-tone="accent"><strong>{counts.coming}</strong> coming up</span>
          <span className={own.left}><strong>{sessionsLeft}</strong>{total ? ` of ${total}` : ""} left</span>
        </p>
        {!sessions.length ? <p className={own.muted}>No sessions in {dateLabel(`${data.month}-01`, { month: "long" })}.</p>
          : <div className={own.grid}>{sessions.map(session => { const k = kind(session), done = session.exercises.filter(row => row.done).length;
            const status = k === "done" ? `✓ Done${session.exercises.length ? ` · ${done} of ${session.exercises.length}` : ""}` : k === "no_show" ? "No-show"
              : k === "next" ? `Next · Coach ${session.coachName}` : k === "upcoming" ? "Coming up" : "Not marked yet";
            return <button key={session.id} type="button" className={own.tile} data-kind={k} onClick={() => setOpen(session)}
              aria-label={`${dateLabel(session.date, { weekday: "long", month: "long", day: "numeric" })}, ${title(session)}, ${status}`}>
              <span className={own.tileHead}><span className={own.num}>{Number(session.date.slice(8))}</span><span className={own.weekday}>{dateLabel(session.date, { weekday: "short" }).toUpperCase()}</span></span>
              <strong>{title(session)}</strong>
              <span className={own.time}>{session.start === null ? "No time recorded" : `${timeLabel(session.start)} · ${session.minutes} min`}</span>
              <span className={own.status}>{status}</span>
            </button>; })}</div>}
      </>}

    {open && <SessionDetail session={open} kind={kind(open)} onClose={() => setOpen(null)} />}
  </section>;
}

/** One session, read-only: what was planned or done, with sets, and the coach's note. */
function SessionDetail({ session, kind, onClose }: { session: Session; kind: Kind; onClose(): void }) {
  const done = session.exercises.filter(row => row.done).length, finished = kind === "done" || kind === "no_show";
  const when = [dateLabel(session.date, { weekday: "short", month: "short", day: "numeric" }), session.start !== null && session.minutes !== null && `${timeLabel(session.start)}–${timeLabel(session.start + session.minutes)}`].filter(Boolean).join(" · ");
  return <Sheet title={title(session)} kicker={when} onClose={onClose}>
    <p className={own.with}><span className={own.badge} data-kind={kind}>{kind === "done" ? "✓ Done" : kind === "no_show" ? "No-show" : kind === "unmarked" ? "Not marked yet" : "Coming up"}</span>with Coach {session.coachName}</p>
    {kind === "no_show" && <p className={own.muted}>No session was used.</p>}
    {session.exercises.length > 0 && <>
      <div className={own.sectionHead}><span>{finished ? "What you did" : "Planned"}</span>{finished && <span>{done} of {session.exercises.length}</span>}</div>
      <ul className={own.exercises}>{session.exercises.map((exercise, at) => <li key={at}>
        <span className={own.tick} data-done={exercise.done || undefined} aria-label={exercise.done ? "Done" : "Not done"}>{exercise.done ? "✓" : "–"}</span>
        <strong data-done={exercise.done || undefined}>{exercise.name}</strong>
        {exercise.sets.length > 0 && <span className={own.sets}>{exercise.sets.map((set, n) => <span key={n}>{setText(set)}</span>)}</span>}
      </li>)}</ul>
    </>}
    {!session.exercises.length && kind !== "no_show" && <p className={own.muted}>{finished || kind === "unmarked" ? "Your coach didn’t list exercises for this session." : "Your coach will plan the exercises."}</p>}
    {session.note && <blockquote className={own.note}><span>Note from Coach {session.coachName}</span>{session.note}</blockquote>}
  </Sheet>;
}
