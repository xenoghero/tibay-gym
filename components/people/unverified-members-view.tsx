"use client";

import { useEffect, useMemo, useState } from "react";
import { attendanceApi } from "@/lib/attendance-api";
import { watchUnverifiedPersons, watchUnverifiedVisits, type UnverifiedPerson } from "@/lib/db/unverified";
import type { AttendanceLog } from "@/lib/db/attendance-log";
import { formatShortDateTime } from "@/lib/dates";
import { BackLink } from "./back-link";
import styles from "./unverified-members.module.css";

type Operation = "approve" | "delete";
interface ReviewResponse { results: Array<{ personId: string; ok: boolean; error?: string }> }
const errorMessages: Record<string, string> = {
  "registration-conflict": "An official profile already uses this phone number. Review that profile before approving.",
  "registration-unavailable": "This registration is no longer available. Refresh the list.",
  "registration-deleting": "Deletion has started. Retry deleting this registration to finish cleanup.",
};

export function UnverifiedMembersView() {
  const [people, setPeople] = useState<UnverifiedPerson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listenerError, setListenerError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [count, setCount] = useState(100);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<{ operation: Operation; people: UnverifiedPerson[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => watchUnverifiedPersons(count, rows => {
    setPeople(rows); setLoaded(true); setListenerError(false);
  }, () => { setListenerError(true); setLoaded(true); }), [count, retry]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return people.filter(person => person.name.toLowerCase().includes(term) || person.phone.includes(term));
  }, [people, search]);
  const chosen = people.filter(person => selected.has(person.id));
  const allSelected = visible.length > 0 && visible.every(person => selected.has(person.id));
  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function requestReview(operation: Operation, rows: UnverifiedPerson[]) {
    setError(""); setMessage(""); setConfirmation({ operation, people: rows });
  }
  async function confirmReview() {
    if (!confirmation || busy) return;
    setBusy(true); setError(""); setMessage("");
    const { operation, people: targets } = confirmation;
    const completed = new Set<string>();
    const failures: string[] = [];
    try {
      // Bounded requests allow selection of more than one page of registrations.
      for (let offset = 0; offset < targets.length; offset += 50) {
        const response = await attendanceApi<ReviewResponse>("/api/attendance/unverified", {
          operation, personIds: targets.slice(offset, offset + 50).map(person => person.id),
        }, true);
        for (const result of response.results) {
          if (result.ok) completed.add(result.personId);
          else failures.push(errorMessages[result.error ?? ""] ?? "Some registrations could not be updated. Please retry.");
        }
      }
      setConfirmation(null);
    } catch {
      failures.push("The result could not be confirmed. Refresh the list and retry any remaining registrations.");
    } finally {
      setSelected(current => new Set([...current].filter(id => !completed.has(id))));
      if (completed.size) setMessage(`${completed.size} ${completed.size === 1 ? "registration" : "registrations"} ${operation === "approve" ? "approved. All earlier visits now count toward official attendance." : "deleted with their check-ins."}`);
      setError([...new Set(failures)].join(" "));
      setBusy(false);
    }
  }

  return <main className={styles.page}>
    <BackLink href="/dashboard/people" label="Back to People" />
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Profile verification</p><h1>Unverified members</h1></div>
      <span className={styles.count}>{loaded ? `${people.length}${people.length === count ? "+" : ""} awaiting review` : "Loading…"}</span>
    </header>
    <p className={styles.description}>Review new accounts, including people who have not checked in yet. Approval adds their profile and all earlier visits to official records. Approved guests can then be converted to members from their profile.</p>
    {listenerError && <div role="alert" className={styles.notice}>Could not load live registrations. <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.toolbar}>
      <input type="search" placeholder="Search name or phone" aria-label="Search unverified members" value={search} onChange={event => setSearch(event.target.value)} />
      <button disabled={busy || !chosen.length || listenerError} onClick={() => requestReview("delete", chosen)}>Delete selected ({chosen.length})</button>
    </div>
    {people.length === count && <p className={styles.description}>Showing the newest {count} registrations. Load more below to include older registrations in your search.</p>}
    {confirmation && <section role="region" aria-label="Confirm registration review" className={styles.confirmation} aria-busy={busy}>
      <h2>{confirmation.operation === "approve" ? `Approve ${confirmation.people[0].name}?` : `Delete ${confirmation.people.length === 1 ? confirmation.people[0].name : `${confirmation.people.length} registrations`}?`}</h2>
      <p>{confirmation.operation === "approve" ? "Their profile and entire check-in history will become official, preserving the original visit dates." : "This rejects the registration and permanently deletes its pending check-ins. They can register again afterward."}</p>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy} onClick={() => void confirmReview()}>{busy ? "Saving…" : confirmation.operation === "approve" ? "Confirm approval" : "Confirm deletion"}</button>
        <button disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
      </div>
    </section>}
    <section className={styles.list} aria-label="Unverified registrations" aria-busy={!loaded}>
      <label className={styles.selectAll}><input type="checkbox" checked={allSelected} disabled={busy || !visible.length} onChange={() => setSelected(current => {
        const next = new Set(current); for (const person of visible) { if (allSelected) next.delete(person.id); else next.add(person.id); } return next;
      })} />Select all shown <span>{visible.length} shown</span></label>
      {!loaded ? <p className={styles.empty}>Loading registrations…</p> : visible.length === 0 ? <p className={styles.empty}>{people.length ? "No registrations match your search." : "No unverified registrations awaiting review."}</p> : visible.map(person => <article key={person.id} className={styles.row}>
        <div className={styles.identity}>
          <input type="checkbox" aria-label={`Select ${person.name}`} checked={selected.has(person.id)} disabled={busy} onChange={() => toggle(person.id)} />
          <div><h2>{person.name}</h2><p>{person.phone}</p><span className={styles.badge}>{person.deletingAt ? "Deletion unfinished" : "Unverified"}</span></div>
        </div>
        <dl className={styles.facts}>
          <div><dt>Registered</dt><dd>{formatShortDateTime(person.createdAt)}</dd></div>
          <div><dt>Last check-in</dt><dd>{formatShortDateTime(person.lastVisitAt)}</dd></div>
          <div><dt>Pending visits</dt><dd>{person.visitCount}</dd></div>
        </dl>
        {person.address && <p className={styles.address}>Address: {person.address}</p>}
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy || listenerError || !!person.deletingAt} onClick={() => requestReview("approve", [person])}>Approve</button>
          <button disabled={busy || listenerError} onClick={() => requestReview("delete", [person])}>{person.deletingAt ? "Retry deletion" : "Delete"}</button>
        </div>
        <VisitHistory personId={person.id} />
      </article>)}
    </section>
    {people.length === count && <button className={styles.more} disabled={busy} onClick={() => setCount(value => value + 100)}>Load more registrations</button>}
  </main>;
}

function VisitHistory({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState<AttendanceLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    return watchUnverifiedVisits(personId, rows => { setVisits(rows); setFailed(false); }, () => setFailed(true));
  }, [personId, open, retry]);
  return <details className={styles.history} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Check-in history</summary>
    {open && (failed ? <p role="alert">Could not load visits. <button onClick={() => setRetry(value => value + 1)}>Retry</button></p> : !visits ? <p>Loading visits…</p> : visits.length === 0 ? <p>No visits recorded.</p> : <div className={styles.historyScroll}><table>
      <thead><tr><th>Checked in</th><th>Checked out</th></tr></thead>
      <tbody>{visits.map(visit => <tr key={visit.id}><td>{formatShortDateTime(visit.checkInAt)}</td><td>{visit.checkOutAt ? formatShortDateTime(visit.checkOutAt) : "Open visit"}</td></tr>)}</tbody>
    </table></div>)}
  </details>;
}
