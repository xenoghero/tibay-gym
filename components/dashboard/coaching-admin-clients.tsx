"use client";

import { useState, type ReactNode } from "react";
import { hourLabel, shortHour } from "@/lib/coaching/bookings";
import { SLOT_RANGES, bookableClient, dateLabel, firstName } from "@/app/coach/schedule";
import { FreezeRequests } from "./coaching-sessions";
import { coachVar, initials, type AdminClient, type AdminData } from "./coaching-admin";
import settings from "./settings.module.css";
import s from "./coaching-admin.module.css";

const days = (client: AdminClient) => client.preferredSchedule?.weekdays.map(day => day[0].toUpperCase() + day.slice(1)).join(", ");
const prefers = (client: AdminClient) => client.preferredSchedule ? `${days(client)} · ${SLOT_RANGES[client.preferredSchedule.timeSlot]}` : "Not given";
/** 09666928971 → 0966 692 8971 */
const phone = (value: string) => /^09\d{9}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4, 7)} ${value.slice(7)}` : value;
const contact = (client: AdminClient) => [phone(client.phone), client.fbName && `FB ${client.fbName}`].filter(Boolean).join(" · ");
const until = (ms: number | null) => ms ? new Date(ms - 1).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }) : null;
const status = (client: AdminClient) => client.frozen ? "Frozen" : client.status === "approved" ? "Not started" : until(client.coachingExpiresAt) ? `Until ${until(client.coachingExpiresAt)}` : "Active";

/** The Clients tab: who needs a coach, then everyone with one. Phones get cards; desktops a table. */
export function AdminClients({ data, colorOf, coachName, tabs, busy, onAssign, onBook, onOpen }: {
  data: AdminData; colorOf(id: string | null | undefined): string; coachName(id: string | null | undefined): string; tabs: ReactNode; busy: boolean;
  onAssign(personId: string): void; onBook(personId: string): void; onOpen(personId: string): void;
}) {
  const [filter, setFilter] = useState(""), [query, setQuery] = useState(""), [freezeKey, setFreezeKey] = useState(0);
  const { today } = data, month = today.slice(0, 7), monthName = dateLabel(today, { month: "long" });
  const nextText = (client: AdminClient) => {
    const next = client.next;
    if (!next) return null;
    const day = next.date === today ? "Today" : dateLabel(next.date, { weekday: "short" });
    return { short: `${day} ${shortHour(next.hour)}`, long: `${next.date === today ? "Today" : dateLabel(next.date, { weekday: "short", month: "short", day: "numeric" })}, ${hourLabel(next.hour)}` };
  };
  const matches = (client: AdminClient) => (!query.trim() || `${client.name} ${client.phone} ${client.fbName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    && (!filter || (filter === "none" ? !client.coachId : client.coachId === filter));
  const list = data.clients.filter(matches).sort((a, b) => Number(!!a.coachId) - Number(!!b.coachId) || a.name.localeCompare(b.name));
  const unassigned = list.filter(client => !client.coachId), assigned = list.filter(client => client.coachId);
  const low = data.clients.filter(client => !client.frozen && client.sessionsLeft <= 1);
  const perCoach = data.coaches.map(coach => {
    const marks = data.marks.filter(row => row.coachId === coach.id && row.date.startsWith(month));
    return { ...coach, done: marks.filter(row => row.outcome === "done").length, noShows: marks.filter(row => row.outcome === "no_show").length };
  });
  const filters = [{ id: "", label: "All", count: data.clients.length }, { id: "none", label: "Needs a coach", count: data.clients.filter(client => !client.coachId).length },
    ...data.coaches.map(coach => ({ id: coach.id, label: firstName(coach.name), count: data.clients.filter(client => client.coachId === coach.id).length }))];
  const chipRow = <div role="group" aria-label="Filter" className={s.chips}>
    {filters.map(row => <button key={row.id || "all"} type="button" className={s.chip} aria-pressed={filter === row.id} onClick={() => setFilter(row.id)}
      style={row.id && row.id !== "none" ? coachVar(colorOf(row.id)) : undefined}>
      {row.id && row.id !== "none" && <span className={s.dot} aria-hidden="true" />}{row.label} <span className={s.count}>{row.count}</span></button>)}
  </div>;
  const search = <input type="search" className={s.search} placeholder="Search clients" aria-label="Search clients" value={query} onChange={event => setQuery(event.target.value)} />;
  const noteFor = (client: AdminClient): [string, string | undefined] => {
    const next = nextText(client);
    if (client.frozen) return ["Frozen", undefined];
    if (next && client.sessionsLeft === 1) return [`Last session ${next.short}`, "accent"];
    if (next) return [client.next?.date === today ? next.short : `Next ${next.short}`, undefined];
    if (client.needsBooking) return ["Nothing booked this week", "accent"];
    return [client.preferredSchedule ? `${days(client)} · ${client.preferredSchedule.timeSlot}s` : "No preferred schedule", undefined];
  };

  return <>
    <div className={s.toolbar}>
      {tabs}
      <div className={`${s.tools} ${s.desktopOnly}`}>{chipRow}{search}</div>
    </div>
    <div className={settings.section} key={freezeKey}><FreezeRequests onChanged={() => setFreezeKey(v => v + 1)} /></div>

    <div className={s.mobileOnly}>
      <section className={s.tiles} aria-label={`Sessions per coach in ${monthName}`} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {perCoach.map(coach => <div key={coach.id}>
          <h2><span className={s.dot} style={coachVar(colorOf(coach.id))} aria-hidden="true" />{coach.name}</h2>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}><strong>{coach.done}</strong><small>done in {dateLabel(today, { month: "short" })} · {coach.noShows} no-show{coach.noShows === 1 ? "" : "s"}</small></span>
        </div>)}
      </section>
      <div style={{ marginTop: 14 }}>{search}</div>
      <div style={{ marginTop: 10 }}>{chipRow}</div>
      {(!filter || filter === "none") && <section aria-labelledby="needs-coach" className={s.feed} style={{ marginTop: 16 }}>
        <div className={s.sectionHead}><h2 id="needs-coach">Needs a coach</h2><span>{unassigned.length} client{unassigned.length === 1 ? "" : "s"}</span></div>
        {unassigned.length ? unassigned.map(client => <article key={client.id} className={s.needsCard}>
          <div className={s.cardTop}>
            <div><strong>{client.name}</strong><small>{contact(client)}</small><span style={{ fontSize: 12 }}>{prefers(client)}</span></div>
            <div className={s.leftCount}><strong>{client.sessionsLeft}</strong><span>{status(client)}</span></div>
          </div>
          <div className={s.cardActions}>
            <button type="button" className={`${s.button} ${s.primary}`} disabled={busy} onClick={() => onAssign(client.id)}>Assign a coach</button>
            <button type="button" className={s.button} onClick={() => onOpen(client.id)}>Sessions</button>
          </div>
        </article>) : <p className={s.feedNote} style={{ marginTop: 0 }}>Everyone has a coach.</p>}
      </section>}
      {filter !== "none" && <section aria-labelledby="with-coach" style={{ marginTop: 18 }}>
        <div className={s.sectionHead} style={{ paddingTop: 0, borderBottom: "1px solid var(--rs-line)", paddingBottom: 8 }}><h2 id="with-coach">With a coach</h2><span>{assigned.length} client{assigned.length === 1 ? "" : "s"}</span></div>
        {assigned.map(client => { const [note, tone] = noteFor(client);
          return <button key={client.id} type="button" className={s.clientRow} onClick={() => onOpen(client.id)}>
            <span className={s.avatar} aria-hidden="true">{initials(client.name)}</span>
            <span className={s.who}><strong>{client.name}</strong><span className={s.meta}><span className={s.dot} style={coachVar(colorOf(client.coachId))} aria-hidden="true" />{firstName(coachName(client.coachId))} · <span data-tone={tone}>{note}</span></span></span>
            <span className={s.left} data-tone={client.sessionsLeft <= 1 && !client.frozen ? "accent" : undefined} style={client.frozen ? { color: "var(--rs-muted)" } : undefined}>{client.sessionsLeft}<small>Left</small></span>
            <span className={s.chev} aria-hidden="true">›</span>
          </button>; })}
        {!assigned.length && <p className={s.empty}>No clients match.</p>}
      </section>}
    </div>

    <section className={`${s.tiles} ${s.desktopOnly}`} aria-label={`${monthName} at a glance`} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
      {perCoach.map(coach => <div key={coach.id}>
        <h2><span className={s.dot} style={coachVar(colorOf(coach.id))} aria-hidden="true" />{coach.name}</h2>
        <strong style={{ fontSize: 34 }}>{coach.done}</strong><small>done in {monthName} · {coach.noShows} no-show{coach.noShows === 1 ? "" : "s"}</small>
      </div>)}
      <div><h2>Needs a coach</h2><strong style={{ fontSize: 34, color: "var(--rs-accent-text)" }}>{data.clients.filter(client => !client.coachId).length}</strong>
        <small>{data.clients.filter(client => !client.coachId).map(client => client.name).join(", ") || "Everyone has a coach"}</small></div>
      <div><h2>Low on sessions</h2><strong style={{ fontSize: 34, color: "var(--rs-accent-text)" }}>{low.length}</strong>
        <small>{low.map(client => client.name).join(", ") || "Nobody is down to their last session"}</small></div>
    </section>

    <div className={`${s.tableBox} ${s.desktopOnly}`}>
      <table className={s.table}>
        <thead><tr><th scope="col">Client</th><th scope="col">Coach</th><th scope="col">Prefers</th><th scope="col" className={s.right}>Sessions left</th><th scope="col">Next session</th><th scope="col"><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>Actions</span></th></tr></thead>
        <tbody>{list.map(client => { const next = nextText(client), lowLeft = client.sessionsLeft <= 1 && !client.frozen;
          return <tr key={client.id} data-unassigned={!client.coachId || undefined}>
            <td><strong>{client.name}</strong><small>{contact(client)}</small></td>
            <td>{client.coachId ? <span className={s.coachName}><span className={s.dot} style={coachVar(colorOf(client.coachId))} aria-hidden="true" />{coachName(client.coachId)}</span>
              : <span className={s.coachName} style={{ color: "var(--rs-accent-text)", fontWeight: 600 }}>No coach yet</span>}</td>
            <td>{prefers(client)}</td>
            <td className={s.right}><strong className={s.bigNumber} style={{ color: lowLeft ? "var(--rs-accent-text)" : client.frozen ? "var(--rs-muted)" : undefined }}>{client.sessionsLeft}</strong>
              <small style={{ display: "block", color: "var(--rs-muted)", fontSize: 11 }}>{status(client)}</small></td>
            <td style={{ color: next && lowLeft ? "var(--rs-accent-text)" : next ? undefined : "var(--rs-muted)" }}>{client.frozen ? "Can’t book while frozen" : next ? `${next.long}${lowLeft ? " · last" : ""}` : client.coachId ? "Nothing booked" : "Not booked"}</td>
            <td><div className={s.actions}>
              {client.coachId
                ? <button type="button" className={`${s.button} ${s.small}`} disabled={busy || !bookableClient(client) || client.sessionsLeft - client.booked <= 0} onClick={() => onBook(client.id)}>Book</button>
                : <button type="button" className={`${s.button} ${s.small} ${s.primary}`} disabled={busy} onClick={() => onAssign(client.id)}>Assign coach</button>}
              <button type="button" className={`${s.button} ${s.small}`} onClick={() => onOpen(client.id)}>Sessions</button>
              <button type="button" className={`${s.iconButton}`} aria-label={`More actions for ${client.name}`} onClick={() => onOpen(client.id)}>⋯</button>
            </div></td>
          </tr>; })}
          {!list.length && <tr><td colSpan={6} style={{ color: "var(--rs-muted)" }}>No clients match.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
