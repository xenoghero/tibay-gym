"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TIME_SLOTS, type CoachingProfile } from "@/lib/coaching/catalog";
import { MemberPhoto, useProfilePhotoUrl, type PhotoPosition } from "@/components/checkin/member-photo";
import { BrandLoading } from "@/components/ui/brand-loading";
import portal from "@/components/checkin/customer-access.module.css";
import styles from "./coach.module.css";

export interface CoachClient {
  id: string; name: string; phone: string; fbName: string | null; goals: string | null; remarks: string | null;
  preferredSchedule: CoachingProfile["preferredSchedule"] | null; status: string; sessionsLeft: number; coachingExpiresAt: number | null; frozen: boolean;
  hasPhoto: boolean; photoPosition: PhotoPosition | null;
}
const days: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };
const schedule = (value: CoachClient["preferredSchedule"]) => value ? `${value.weekdays.map(day => days[day]).join(", ")} · ${TIME_SLOTS[value.timeSlot]}` : "Not given";
const statusLabel = (client: CoachClient) => client.frozen ? "Frozen" : ({ approved: "Not started", active: "Active", used_up: "No sessions left", expired: "Expired" } as Record<string, string>)[client.status] ?? client.status;
/** The member portal's badge tones: approved = green, pending = yellow, closed = grey, rejected = red. */
const tone = (client: CoachClient) => client.frozen ? "closed" : client.status === "active" ? "approved" : client.status === "approved" ? "pending" : "rejected";
const toneIcon: Record<string, string> = { approved: "●", pending: "◷", closed: "❄", rejected: "×" };
const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Not set yet";

export async function coachFetch(user: User, path: string, init: RequestInit = {}) {
  return fetch(path, { ...init, cache: "no-store", headers: { ...init.headers, Authorization: `Bearer ${await user.getIdToken()}` } });
}

function StatusBadge({ client }: { client: CoachClient }) {
  const status = tone(client);
  return <span className={portal.badge} data-status={status}><span aria-hidden="true">{toneIcon[status]}</span>{statusLabel(client)}</span>;
}

/** The coach's assigned clients, then one client's details. `children` renders below the selected client's card (session tools). */
export function CoachClients({ user, coachName, children }: { user: User; coachName: string; children?: (client: CoachClient, reload: () => void) => ReactNode }) {
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
  const open = (id: string | null) => { setSelected(id); window.scrollTo?.({ top: 0, behavior: "instant" }); };

  if (error) return <section className={styles.panel}><p className={portal.error} role="alert">{error}</p><button type="button" className={portal.secondaryButton} onClick={() => setReload(v => v + 1)}>Retry</button></section>;
  if (!clients) return <div className={styles.loading}><BrandLoading label="Loading your clients" /></div>;
  if (client) return <div className={styles.stack}>
    <button type="button" className={portal.textButton} style={{ justifySelf: "start" }} onClick={() => open(null)}>‹ All clients</button>
    <ClientPass user={user} client={client} />
    {/* Recording a session comes before the profile: it is what coaches do most, usually on a phone. */}
    {children?.(client, () => setReload(v => v + 1))}
    <section className={styles.panel} aria-labelledby="client-about">
      <h2 id="client-about" className={styles.title}>About {client.name.split(" ")[0]}</h2>
      <dl className={styles.facts}>
        <div><dt>Phone</dt><dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd></div>
        <div><dt>FB name</dt><dd>{client.fbName ?? "Not given"}</dd></div>
        <div className={styles.wide}><dt>Preferred schedule</dt><dd>{schedule(client.preferredSchedule)}</dd></div>
        <div className={styles.wide}><dt>Goals</dt><dd>{client.goals ?? "Not given"}</dd></div>
        <div className={styles.wide}><dt>Remarks</dt><dd>{client.remarks ?? "None"}</dd></div>
      </dl>
    </section>
  </div>;
  return <>
    <div className={portal.portalHeading}>
      <span className={portal.eyebrow}>Hi, {coachName}</span>
      <h1 style={{ marginTop: 10 }}>Your clients</h1>
    </div>
    {!clients.length ? <div className={portal.empty}><span aria-hidden="true">↗</span><h3>No clients yet</h3><p>The admin assigns clients from the dashboard.</p></div> :
      <ul className={styles.clients} aria-label="Your clients">{clients.map(row => <li key={row.id}>
        <button type="button" className={styles.client} data-low={row.sessionsLeft === 1 && !row.frozen ? "" : undefined} onClick={() => open(row.id)}>
          <strong>{row.name}</strong>
          <span className={styles.count}>{row.sessionsLeft}<small>left</small></span>
          <span className={styles.meta}><StatusBadge client={row} /><span>{row.sessionsLeft === 1 && !row.frozen ? "Last session · renew soon" : schedule(row.preferredSchedule)}</span></span>
        </button>
      </li>)}</ul>}
  </>;
}

/** The client's Coaching card, built like the member portal's Membership card, with their profile photo. */
function ClientPass({ user, client }: { user: User; client: CoachClient }) {
  const load = useCallback((signal: AbortSignal) => coachFetch(user, `/api/coach/clients/photo?id=${encodeURIComponent(client.id)}`, { signal }), [user, client.id]);
  const photoUrl = useProfilePhotoUrl(client.hasPhoto, 0, load);
  return <section className={`${portal.memberPass} ${styles.pass}`} aria-label="Coaching card" data-status={client.frozen ? "frozen" : client.status}>
    <span className={portal.passWatermark} aria-hidden="true">TG</span>
    <div className={portal.passGrid}>
      <div className={portal.passBrand}>TIBAY <span>GYM</span><small>Coaching</small></div>
      <div className={portal.passIdentity}>
        <h1 className={portal.passStatus}>{statusLabel(client)}</h1>
        <p className={portal.passName}>{client.name}</p>
        <div className={portal.passMeta}><span>{schedule(client.preferredSchedule)}</span></div>
      </div>
      <MemberPhoto url={photoUrl} position={client.photoPosition} name={client.name} />
      <div className={styles.passFacts}>
        <div className={portal.passExpiry}><span>Coaching until</span><strong>{until(client.coachingExpiresAt)}</strong>{!client.coachingExpiresAt && <small>Starts at first session or check-in</small>}</div>
        <div className={portal.passExpiry}><span>Sessions left</span><strong>{client.sessionsLeft}</strong></div>
      </div>
    </div>
  </section>;
}
