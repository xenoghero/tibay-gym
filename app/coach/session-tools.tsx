"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { philippineDate } from "@/lib/finance/rules";
import portal from "@/components/checkin/customer-access.module.css";
import { coachFetch, type CoachClient } from "./coach-clients";
import styles from "./coach.module.css";

interface Mark { id: string; date: string; outcome: "done" | "no_show"; note: string | null; coachId: string; coachName: string; createdAt: number }
const messages: Record<string, string> = {
  "no-sessions-left": "This client has no sessions left.", "coaching-expired": "This client's coaching validity has ended.",
  "client-frozen": "This client's package is frozen.", "client-not-assigned": "This client is no longer assigned to you.",
  "invalid-session-date": "Choose today or a day in the last 30 days.", "mark-undo-closed": "Marks can only be undone on the day you made them. Ask the admin.",
};
const manilaToday = () => philippineDate(Date.now());
const shortDate = (date: string) => new Date(`${date}T00:00:00+08:00`).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

/** Mark a Coaching session done or a No-show, see the client's history, and undo today's own marks. */
export function SessionTools({ user, coachId, client, onChanged }: { user: User; coachId: string; client: CoachClient; onChanged(): void }) {
  const [history, setHistory] = useState<Mark[] | null>(null), [reload, setReload] = useState(0);
  const [date, setDate] = useState(manilaToday), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    coachFetch(user, `/api/coach/clients?id=${encodeURIComponent(client.id)}`).then(async response => {
      if (!response.ok) throw new Error();
      const data: { history: Mark[] } = await response.json();
      if (active) setHistory(data.history);
    }).catch(() => { if (active) setError("Could not load the session history."); });
    return () => { active = false; };
  }, [user, client.id, reload]);

  async function send(body: Record<string, unknown>, done: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await coachFetch(user, "/api/coach/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(messages[(await response.json().catch(() => ({}))).error] ?? "Could not save. Check your connection and try again.");
      setMessage(done); setNote(""); setReload(v => v + 1); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setBusy(false); }
  }
  const record = (outcome: "done" | "no_show") => (event?: FormEvent) => {
    event?.preventDefault();
    void send({ action: "mark", personId: client.id, outcome, date, note, operationId: crypto.randomUUID() }, outcome === "done" ? "Session marked done." : "No-show recorded. No session was used.");
  };
  const today = manilaToday(), canMark = !client.frozen && client.sessionsLeft > 0 && client.status !== "expired";

  return <>
    <form className={`${styles.panel} ${styles.form}`} onSubmit={record("done")} aria-labelledby="mark-title">
      <h2 id="mark-title" className={styles.title}>Record a session</h2>
      <label>Date<input type="date" required value={date} max={today} onChange={e => setDate(e.target.value)} /></label>
      <label>Note (optional)<input maxLength={500} placeholder="What did you work on?" value={note} onChange={e => setNote(e.target.value)} /></label>
      {!canMark && <p className={styles.hint}>{client.frozen ? "Frozen: sessions can't be marked." : client.status === "expired" ? "Coaching validity has ended." : "No sessions left."} You can still record a No-show.</p>}
      {error && <p className={portal.error} role="alert">{error}</p>}
      {message && <p className={portal.confirmation} role="status">{message}</p>}
      <button type="submit" className={`${portal.primaryButton} ${portal.membershipCta}`} disabled={busy || !canMark}>
        <span aria-hidden="true">✓</span>{busy ? "Saving…" : "Mark session done"}<span aria-hidden="true">›</span>
      </button>
      <button type="button" className={`${portal.secondaryButton} ${styles.full}`} disabled={busy} onClick={() => record("no_show")()}>Record no-show</button>
      <p className={styles.hint}>A no-show doesn’t use a session.</p>
    </form>
    <section className={styles.stack} aria-labelledby="history-title">
      <h2 id="history-title" className={styles.title}>Session history</h2>
      {!history ? <p className={styles.hint}>Loading…</p> : !history.length ? <p className={styles.hint}>No sessions recorded yet.</p> :
        <ul className={styles.history}>{history.map(mark => {
          const mine = mark.coachId === coachId, todayMark = philippineDate(mark.createdAt) === today;
          return <li key={mark.id}>
            <div><time dateTime={mark.date}>{shortDate(mark.date)}</time><span>{mine ? "By you" : `By ${mark.coachName}`}</span></div>
            <span className={portal.badge} data-status={mark.outcome === "done" ? "approved" : "closed"}><span aria-hidden="true">{mark.outcome === "done" ? "✓" : "−"}</span>{mark.outcome === "done" ? "Session done" : "No-show"}</span>
            {mark.note && <p>{mark.note}</p>}
            {mine && todayMark && <button type="button" className={styles.undo} disabled={busy} onClick={() => void send({ action: "undo", markId: mark.id }, "Mark undone.")}>Undo</button>}
          </li>;
        })}</ul>}
    </section>
  </>;
}
