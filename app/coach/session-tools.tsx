"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { timeLabel } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import portal from "@/components/checkin/customer-access.module.css";
import { coachFetch, type CoachClient } from "./coach-clients";
import styles from "./coach.module.css";

interface Mark {
  id: string; date: string; outcome: "done" | "no_show"; note: string | null; coachId: string; coachName: string; createdAt: number;
  start: number | null; muscles: string[]; exercisesDone: number; exercisesTotal: number;
}
const shortDate = (date: string) => new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

/** The client's session history, newest first, with today's own marks undoable. Sessions are added and marked from the Schedule. */
export function SessionTools({ user, coachId, client, onChanged }: { user: User; coachId: string; client: CoachClient; onChanged(): void }) {
  const [history, setHistory] = useState<Mark[] | null>(null), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [today] = useState(() => philippineDate(Date.now()));
  useEffect(() => {
    let active = true;
    coachFetch(user, `/api/coach/clients?id=${encodeURIComponent(client.id)}`).then(async response => {
      if (!response.ok) throw new Error();
      const data: { history: Mark[] } = await response.json();
      if (active) setHistory(data.history);
    }).catch(() => { if (active) setError("Could not load the session history."); });
    return () => { active = false; };
  }, [user, client.id, reload]);

  async function undo(markId: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await coachFetch(user, "/api/coach/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo", markId }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error === "mark-undo-closed" ? "Marks can only be undone on the day you made them. Ask the admin." : "Could not undo. Check your connection and try again.");
      setMessage("Mark undone."); setReload(v => v + 1); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not undo."); }
    finally { setBusy(false); }
  }

  return <section className={styles.stack} aria-labelledby="history-title">
    <h2 id="history-title" className={styles.title}>Session history</h2>
    <p className={styles.hint}>Add, plan and mark sessions from your Schedule.</p>
    {error && <p className={portal.error} role="alert">{error}</p>}
    {message && <p className={portal.confirmation} role="status">{message}</p>}
    {!history ? <p className={styles.hint}>Loading…</p> : !history.length ? <p className={styles.hint}>No sessions recorded yet.</p> :
      <ul className={styles.history}>{history.map(mark => {
        const mine = mark.coachId === coachId, todayMark = philippineDate(mark.createdAt) === today;
        const detail = [mark.start !== null ? timeLabel(mark.start) : "No time recorded", mark.muscles.join(", "), mark.exercisesTotal ? `${mark.exercisesDone} of ${mark.exercisesTotal} exercises` : ""].filter(Boolean).join(" · ");
        return <li key={mark.id}>
          <div><time dateTime={mark.date}>{shortDate(mark.date)}</time><span>{detail} · {mine ? "By you" : `By ${mark.coachName}`}</span></div>
          <span className={portal.badge} data-status={mark.outcome === "done" ? "approved" : "closed"}><span aria-hidden="true">{mark.outcome === "done" ? "✓" : "−"}</span>{mark.outcome === "done" ? "Session done" : "No-show"}</span>
          {mark.note && <p>{mark.note}</p>}
          {mine && todayMark && <button type="button" className={styles.undo} disabled={busy} onClick={() => void undo(mark.id)}>Undo</button>}
        </li>;
      })}</ul>}
  </section>;
}
