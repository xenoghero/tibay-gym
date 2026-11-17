"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TIME_SLOTS, type CoachingProfile } from "@/lib/coaching/catalog";
import styles from "./coach.module.css";

export interface CoachClient {
  id: string; name: string; phone: string; fbName: string | null; goals: string | null; remarks: string | null;
  preferredSchedule: CoachingProfile["preferredSchedule"] | null; status: string; sessionsLeft: number; coachingExpiresAt: number | null; frozen: boolean;
}
const days: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
const schedule = (value: CoachClient["preferredSchedule"]) => value ? `${value.weekdays.map(day => days[day]).join(", ")} · ${TIME_SLOTS[value.timeSlot]}` : "Not given";
const statusLabel = (client: CoachClient) => client.frozen ? "Frozen" : ({ approved: "Not started", active: "Active", used_up: "No sessions left", expired: "Expired" } as Record<string, string>)[client.status] ?? client.status;
const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Starts at first session or check-in";

export async function coachFetch(user: User, path: string, init: RequestInit = {}) {
  return fetch(path, { ...init, cache: "no-store", headers: { ...init.headers, Authorization: `Bearer ${await user.getIdToken()}` } });
}

/** The coach's assigned clients, then one client's details. `children` renders below the selected client (session tools). */
export function CoachClients({ user, children }: { user: User; children?: (client: CoachClient, reload: () => void) => ReactNode }) {
  const [clients, setClients] = useState<CoachClient[] | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    coachFetch(user, "/api/coach/clients").then(async response => {
      if (!response.ok) throw new Error();
      const data: { clients: CoachClient[] } = await response.json();
      if (active) { setClients(data.clients); setError(""); }
    }).catch(() => { if (active) setError("Could not load your clients. Try again."); });
    return () => { active = false; };
  }, [user, reload]);
  const client = clients?.find(row => row.id === selected);

  if (error) return <section className={styles.card}><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.ghost} onClick={() => setReload(v => v + 1)}>Retry</button></section>;
  if (!clients) return <section className={styles.card} aria-busy="true"><p className={styles.muted}>Loading your clients…</p></section>;
  if (client) return <section className={styles.card} aria-labelledby="client-name">
    <button type="button" className={styles.ghost} style={{ justifySelf: "start" }} onClick={() => setSelected(null)}>← All clients</button>
    <h2 id="client-name">{client.name}</h2>
    <dl className={styles.facts}>
      <div><dt>Sessions left</dt><dd>{client.sessionsLeft}</dd></div>
      <div><dt>Status</dt><dd>{statusLabel(client)}</dd></div>
      <div><dt>Coaching until</dt><dd>{until(client.coachingExpiresAt)}</dd></div>
    </dl>
    {/* Recording a session comes before the profile: it is what coaches do most, usually on a phone. */}
    {children?.(client, () => setReload(v => v + 1))}
    <h3 className={styles.subhead}>About {client.name.split(" ")[0]}</h3>
    <dl className={styles.facts}>
      <div><dt>Phone</dt><dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd></div>
      <div><dt>FB name</dt><dd>{client.fbName ?? "Not given"}</dd></div>
      <div><dt>Preferred schedule</dt><dd>{schedule(client.preferredSchedule)}</dd></div>
      <div className={styles.wide}><dt>Goals</dt><dd>{client.goals ?? "Not given"}</dd></div>
      <div className={styles.wide}><dt>Remarks</dt><dd>{client.remarks ?? "None"}</dd></div>
    </dl>
  </section>;
  return <section className={styles.card} aria-labelledby="coach-clients">
    <h2 id="coach-clients">Your clients</h2>
    {!clients.length && <p className={styles.muted}>No clients are assigned to you yet. The admin assigns clients from the dashboard.</p>}
    <ul className={styles.list}>{clients.map(row => <li key={row.id}><button type="button" onClick={() => setSelected(row.id)}>
      <strong>{row.name}</strong><span>{row.sessionsLeft} {row.sessionsLeft === 1 ? "session" : "sessions"} left · {statusLabel(row)}</span><small>{schedule(row.preferredSchedule)}</small>
    </button></li>)}</ul>
  </section>;
}
