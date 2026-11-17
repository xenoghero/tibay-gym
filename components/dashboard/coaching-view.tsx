"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { TIME_SLOTS, type CoachingProfile } from "@/lib/coaching/catalog";
import { ClientSessions, CoachMonthlyCounts, FreezeRequests } from "./coaching-sessions";
import styles from "./settings.module.css";

interface Client {
  id: string; name: string; phone: string; fbName: string | null; goals: string | null; remarks: string | null;
  preferredSchedule: CoachingProfile["preferredSchedule"] | null; status: string; sessionsLeft: number; coachingExpiresAt: number | null; frozen: boolean;
  coachId: string | null; coachName: string | null;
}
interface Data { unassigned: Client[]; assigned: Client[]; coaches: { id: string; name: string }[] }
const days: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
export const scheduleLabel = (schedule: Client["preferredSchedule"]) =>
  schedule ? `${schedule.weekdays.map(day => days[day]).join(", ")} · ${TIME_SLOTS[schedule.timeSlot]}` : "Not given";
const date = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }) : "Starts at first visit";

/** Admin coaching desk: Unassigned clients first, then everyone with a coach. */
export function CoachingView() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Client | null>(null);
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken().then(token => fetch("/api/admin/coach-assignments", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error(); const next: Data = await response.json(); if (active) { setData(next); setError(""); } })
      .catch(() => { if (active) setError("Could not load coaching clients. Reload to try again."); });
    return () => { active = false; };
  }, [user, reload]);

  async function assign(client: Client) {
    const coachId = choice[client.id];
    if (!user || busy || !coachId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/coach-assignments", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ personId: client.id, coachId }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error === "coach-unavailable" ? "That coach is no longer active. Reload the list." : "Could not assign the coach. Reload and try again.");
      setMessage(`${client.name} is now coached by ${data?.coaches.find(c => c.id === coachId)?.name ?? "the selected coach"}.`);
      setChoice(current => ({ ...current, [client.id]: "" })); setReload(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not assign the coach."); }
    finally { setBusy(false); }
  }
  const picker = (client: Client) => <div className={styles.actions}>
    <select aria-label={`Coach for ${client.name}`} value={choice[client.id] ?? ""} disabled={busy || !data?.coaches.length} onChange={e => setChoice({ ...choice, [client.id]: e.target.value })} style={{ minWidth: 160 }}>
      <option value="">{client.coachId ? "Switch coach…" : "Choose coach…"}</option>
      {data?.coaches.filter(coach => coach.id !== client.coachId).map(coach => <option key={coach.id} value={coach.id}>{coach.name}</option>)}
    </select>
    <button type="button" className={styles.primary} disabled={busy || !choice[client.id]} onClick={() => void assign(client)}>{client.coachId ? "Switch" : "Assign"}</button>
    <button type="button" onClick={() => setOpen(client)}>Sessions</button>
  </div>;
  const table = (clients: Client[], assigned: boolean) => <table className={styles.table}>
    <thead><tr><th scope="col">Client</th><th scope="col">Preferred schedule</th><th scope="col">Sessions left</th>{assigned && <th scope="col">Coach</th>}<th scope="col" aria-label="Actions" /></tr></thead>
    <tbody>{clients.map(client => <tr key={client.id}>
      <td>{client.name}<small>{client.phone}{client.fbName ? ` · FB ${client.fbName}` : ""}</small>{client.goals && <small>Goals: {client.goals}</small>}{client.remarks && <small>Remarks: {client.remarks}</small>}</td>
      <td>{scheduleLabel(client.preferredSchedule)}</td>
      <td className={styles.number}>{client.sessionsLeft}<small>{client.frozen ? "Frozen" : client.status === "approved" ? "Not started" : `Until ${date(client.coachingExpiresAt)}`}</small></td>
      {assigned && <td>{client.coachName}</td>}
      <td>{picker(client)}</td>
    </tr>)}</tbody>
  </table>;

  return <main className={styles.section} style={{ padding: "clamp(20px, 4vw, 40px)" }}>
    <div className={styles.head}><div><h2>Coaching</h2><p className={styles.sub}>Approved clients with coaching sessions available. Each client has one coach; sessions already done stay credited to the coach who ran them.</p></div></div>
    <p className={styles.error} role="alert">{error}</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    {!data && !error && <div className={styles.skeleton} aria-label="Loading coaching clients" />}
    {data && !data.coaches.length && <p className={styles.message}>Create a coach in Settings → Coaching before assigning clients.</p>}
    {data && <>
      <FreezeRequests onChanged={() => setReload(v => v + 1)} />
      <h3 style={{ margin: "24px 0 8px" }}>Unassigned clients</h3>
      {data.unassigned.length ? table(data.unassigned, false) : <div className={styles.empty}><h3>Everyone has a coach</h3><p>New clients appear here once their coaching payment is approved.</p></div>}
      <h3 style={{ margin: "32px 0 8px" }}>Clients with a coach</h3>
      {data.assigned.length ? table(data.assigned, true) : <div className={styles.empty}><p>No clients are assigned yet.</p></div>}
      {open && <ClientSessions key={open.id} personId={open.id} name={open.name} onClose={() => { setOpen(null); setReload(v => v + 1); }} />}
      <CoachMonthlyCounts />
    </>}
  </main>;
}
