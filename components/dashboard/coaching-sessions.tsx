"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import styles from "./settings.module.css";

interface Mark { id: string; date: string; outcome: "done" | "no_show"; note: string | null; coachName: string }
interface Holding { id: string; topUp: boolean; sessions: number; sessionsLeft: number; coachingExpiresAt: number | null }
interface PackageSummary { sessionsLeft: number; holdings: Holding[] }
const errors: Record<string, string> = { "adjustment-reason-required": "Enter a reason for the adjustment.", "no-sessions-left": "The client has no sessions left to use.",
  "coaching-expired": "The client's coaching validity has ended.", "invalid-sessions-left": "Enter a whole number of sessions, 0 or more." };

function useAdminFetch() {
  const { user } = useAuth();
  return async (path: string, body?: unknown) => {
    if (!user) throw new Error("Sign in again to continue.");
    const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(20_000), ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errors[result.error] ?? "Could not complete that. Reload and try again.");
    return result;
  };
}

/** One client's session history with admin undo/fix, and the Session adjustment form. */
export function ClientSessions({ personId, name, onClose }: { personId: string; name: string; onClose(): void }) {
  const call = useAdminFetch();
  const [data, setData] = useState<{ history: Mark[]; package: PackageSummary | null } | null>(null), [reload, setReload] = useState(0);
  const [left, setLeft] = useState(""), [reason, setReason] = useState(""), [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    call(`/api/admin/coaching-sessions?personId=${encodeURIComponent(personId)}`).then(result => { if (active) setData(result); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on client or explicit refresh only
  }, [personId, reload]);
  async function act(body: Record<string, unknown>, done: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await call("/api/admin/coaching-sessions", body); setMessage(done); setReload(v => v + 1); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not complete that."); }
    finally { setBusy(false); }
  }
  return <section className={styles.editor} aria-labelledby="client-sessions-title" style={{ marginTop: 24 }}>
    <div className={styles.head}><div><h2 id="client-sessions-title">{name}: sessions</h2>
      {data?.package && <p className={styles.sub}>{data.package.sessionsLeft} sessions left in total</p>}</div>
      <button type="button" onClick={onClose}>Close</button></div>
    <p className={styles.error} role="alert">{error}</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    {data?.package && data.package.holdings.length > 0 && <fieldset disabled={busy}>
      <legend>Session adjustment</legend>
      <div className={styles.fields}>
        <label>Sessions to adjust<select value={target || data.package.holdings[0].id} onChange={e => setTarget(e.target.value)}>
          {data.package.holdings.map(row => <option key={row.id} value={row.id}>{row.topUp ? "Session top-ups" : "Coaching package"} · {row.sessionsLeft} left</option>)}</select></label>
        <label>Sessions left<input inputMode="numeric" value={left} onChange={e => setLeft(e.target.value)} /></label>
        <label>Reason<input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      </div>
      <div className={styles.actions} style={{ marginTop: 12 }}><button type="button" className={styles.primary} disabled={!left.trim() || !reason.trim()}
        onClick={() => void act({ action: "adjust", packageRecordId: target || data.package!.holdings[0].id, sessionsLeft: Number(left), reason }, "Session adjustment saved.").then(() => { setLeft(""); setReason(""); })}>Save adjustment</button></div>
    </fieldset>}
    {!data ? <div className={styles.skeleton} aria-label="Loading sessions" /> : !data.history.length ? <div className={styles.empty}><p>No sessions recorded yet.</p></div> :
      <table className={styles.table}><thead><tr><th scope="col">Date</th><th scope="col">Outcome</th><th scope="col">Coach</th><th scope="col" aria-label="Actions" /></tr></thead>
        <tbody>{data.history.map(mark => <tr key={mark.id}>
          <td className={styles.number}>{mark.date}</td>
          <td>{mark.outcome === "done" ? "Session done" : "No-show"}{mark.note && <small>{mark.note}</small>}</td>
          <td>{mark.coachName}</td>
          <td><div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void act({ action: "fix", markId: mark.id, outcome: mark.outcome === "done" ? "no_show" : "done" }, "Mark corrected.")}>{mark.outcome === "done" ? "Change to No-show" : "Change to done"}</button>
            <button type="button" disabled={busy} className={styles.danger} onClick={() => void act({ action: "undo", markId: mark.id }, "Mark undone.")}>Undo</button>
          </div></td>
        </tr>)}</tbody></table>}
  </section>;
}

/** Monthly Coaching sessions and No-shows per coach, for working out coach pay outside the system. */
export function CoachMonthlyCounts() {
  const call = useAdminFetch();
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()).slice(0, 7));
  const [data, setData] = useState<{ coaches: { coachId: string; name: string; done: number; noShows: number }[] } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    call(`/api/admin/coaching-sessions?month=${month}`).then(result => { if (active) { setData(result); setError(""); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when the month changes
  }, [month]);
  return <section aria-labelledby="coach-counts-title" style={{ marginTop: 32 }}>
    <div className={styles.toolbar}><h3 id="coach-counts-title" style={{ margin: 0, flex: 1 }}>Sessions per coach</h3>
      <label>Month<input type="month" value={month} onChange={e => { if (e.target.value) { setData(null); setMonth(e.target.value); } }} /></label></div>
    <p className={styles.error} role="alert">{error}</p>
    {!data && !error && <div className={styles.skeleton} aria-label="Loading counts" />}
    {data && (data.coaches.length ? <table className={styles.table}><thead><tr><th scope="col">Coach</th><th scope="col">Sessions done</th><th scope="col">No-shows</th></tr></thead>
      <tbody>{data.coaches.map(row => <tr key={row.coachId}><td>{row.name}</td><td className={styles.number}>{row.done}</td><td className={styles.number}>{row.noShows}</td></tr>)}</tbody></table>
      : <div className={styles.empty}><p>No sessions recorded this month.</p></div>)}
  </section>;
}
