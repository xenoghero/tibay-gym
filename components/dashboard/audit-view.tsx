"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { AuditEvent } from "@/lib/server/audit";
import styles from "./audit-view.module.css";

type Event = AuditEvent & { id: string };
interface Page { events: Event[]; nextCursor: string | null }
const emptyFilters = { from: "", through: "", action: "", personId: "", entityId: "" };
type Filters = typeof emptyFilters;
const filterLabels: Record<keyof Filters, string> = {
  from: "From", through: "Through", action: "Action", personId: "Customer ID", entityId: "Record ID",
};
const entityLabels: Record<string, string> = {
  paymentRequest: "Payment request", unverifiedPerson: "Registration", person: "Person",
  receipt: "Receipt", charge: "Charge", settings: "Settings",
};
function readable(value: string) {
  const text = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/\b(ocr|rfid|sms|qr)\b/gi, word => word.toUpperCase());
}
function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}
function dateParts(value: number) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit" }),
  };
}
function fieldLabel(field: string) {
  return readable(field.replace(/Minor$/, ""));
}
function displayValue(value: unknown, field: string) {
  if (value === undefined) return "Not recorded";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && field.endsWith("Minor")) {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
  }
  if (typeof value === "number" && /^(membershipExpiry|joinDate|lastVisitAt|checkOutAt|checkInAt|financialCutoverAt|filingDeadline|filedAt|accountingDeleteAfter)$/.test(field)) {
    const date = dateParts(value);
    return `${date.date}, ${date.time} PHT`;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [message, setMessage] = useState("");
  return <div className={styles.identifier}>
    <dt>{label}</dt>
    <dd><code>{value}</code><button type="button" className={styles.copyButton}
      aria-label={`Copy ${label.toLowerCase()}`} onClick={async () => {
        try { await navigator.clipboard.writeText(value); setMessage("Copied"); }
        catch { setMessage("Could not copy. Select the ID to copy manually."); }
      }}>Copy ID</button></dd>
    <span className={styles.copyStatus} role="status">{message}</span>
  </div>;
}

function EventDrawer({ event, onClose }: { event: Event; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const date = dateParts(event.occurredAt);
  const before = event.relevantBefore ?? {};
  const after = event.relevantAfter ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className={styles.drawer} aria-labelledby="audit-detail-title"
    onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.drawerInner}>
      <header className={styles.drawerHeader}>
        <div><p className={styles.kicker}>Event details</p><h2 id="audit-detail-title">{readable(event.action)}</h2>
          <p className={styles.muted}>{date.date} · {date.time} PHT</p></div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close event details">✕</button>
      </header>
      <div className={styles.drawerBody}>
        <section className={styles.detailSection} aria-labelledby="audit-context-title">
          <h3 id="audit-context-title">Event context</h3>
          <dl className={styles.context}>
            <div><dt>Record type</dt><dd>{entityLabels[event.entityType] ?? readable(event.entityType)}</dd></div>
            <div><dt>Reason</dt><dd>{event.reason || "No reason recorded."}</dd></div>
          </dl>
        </section>
        <section className={styles.detailSection} aria-labelledby="audit-changes-title">
          <div className={styles.sectionHeading}><h3 id="audit-changes-title">What changed</h3><span>{fields.length} {fields.length === 1 ? "field" : "fields"}</span></div>
          {fields.length ? <table className={styles.changes}>
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{fields.map(field => <tr key={field}><th scope="row">{fieldLabel(field)}</th>
              <td>{displayValue(before[field], field)}</td><td>{displayValue(after[field], field)}</td></tr>)}</tbody>
          </table> : <p className={styles.muted}>No field-level changes were recorded for this event.</p>}
        </section>
        <section className={styles.detailSection} aria-labelledby="audit-identifiers-title">
          <h3 id="audit-identifiers-title">Identifiers</h3>
          <dl className={styles.identifiers}>
            <CopyValue label="Actor ID" value={event.actorId} />
            <CopyValue label="Record ID" value={event.entityId} />
            {event.personId && <CopyValue label="Customer ID" value={event.personId} />}
            <CopyValue label="Event ID" value={event.id} />
            <CopyValue label="Operation ID" value={event.operationId} />
          </dl>
        </section>
        <details className={styles.raw}><summary>Raw event data</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
      </div>
    </div>
  </dialog>;
}

export function AuditView() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>({ events: [], nextCursor: null });
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ filters: Filters; cursor?: string }>({ filters: emptyFilters });
  const activeCount = Object.values(applied).filter(Boolean).length;

  const load = useCallback(async (snapshot: Filters, cursor?: string) => {
    if (!user) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    lastRequest.current = { filters: snapshot, cursor };
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(snapshot)) if (value) params.set(key, value);
      if (cursor) params.set("cursor", cursor);
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      const response = await fetch(`/api/admin/audit?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load audit history. Please try again.");
      const data: Page = await response.json();
      if (controller.signal.aborted) return;
      setPage(previous => cursor ? {
        events: [...previous.events, ...data.events.filter(event => !previous.events.some(old => old.id === event.id))],
        nextCursor: data.nextCursor,
      } : data);
      setApplied(snapshot);
      setLoaded(true);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load audit history.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    // Defer until the auth effect is mounted; Strict Mode cleanup cancels its first pass.
    void Promise.resolve().then(() => { if (active) void load(emptyFilters); });
    return () => { active = false; requestRef.current?.abort(); };
  }, [load]);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    if (filters.from && filters.through && filters.from > filters.through) {
      setError("Choose a Through date on or after the From date.");
      return;
    }
    void load({ ...filters });
  }
  function clearFilters() {
    setFilters(emptyFilters);
    void load(emptyFilters);
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>Administration / activity log</p><h1>Audit history</h1></div>
      <button className={styles.button} disabled={busy} onClick={() => void load(applied)}>
        <span aria-hidden="true">↻</span><span className={styles.buttonLabel}>{busy ? "Refreshing…" : "Refresh"}</span>
      </button>
    </header>
    <p className={styles.intro}>Track administrative changes. All times are Philippine time (PHT). History remains after profile deletion.</p>
    <section className={styles.filterSection} aria-label="Audit filters">
      <button className={`${styles.button} ${styles.filterToggle}`} aria-expanded={filtersOpen} aria-controls="audit-filters"
        onClick={() => setFiltersOpen(open => !open)}>Filters {activeCount > 0 && <span className={styles.count}>{activeCount}</span>}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button>
      <form id="audit-filters" className={`${styles.filters} ${filtersOpen ? styles.filtersOpen : ""}`} onSubmit={applyFilters}>
        {(Object.keys(emptyFilters) as Array<keyof Filters>).map(key => <label key={key}>
          <span>{filterLabels[key]}</span>
          <input type={key === "from" || key === "through" ? "date" : "text"}
            value={filters[key]} maxLength={128} placeholder={key === "action" ? "e.g. payment-approved" : "Exact ID"}
            max={key === "from" ? filters.through || undefined : undefined}
            min={key === "through" ? filters.from || undefined : undefined}
            onChange={e => setFilters(current => ({ ...current, [key]: e.target.value }))} />
        </label>)}
        <div className={styles.filterActions}>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>Apply filters</button>
          <button type="button" className={styles.textButton} disabled={busy} onClick={clearFilters}>Clear filters</button>
        </div>
      </form>
    </section>
    <div className={styles.resultsHeader}>
      <h2>Recorded activity <span className={styles.count}>{page.events.length}</span></h2>
      <span className={styles.muted}>{activeCount ? `${activeCount} active ${activeCount === 1 ? "filter" : "filters"}` : "All activity"} · Newest first</span>
    </div>
    {activeCount > 0 && <div className={styles.activeFilters} aria-label="Applied filters">
      {(Object.entries(applied) as Array<[keyof Filters, string]>).filter(([, value]) => value).map(([key, value]) => <span key={key}>{filterLabels[key]}: {value}</span>)}
    </div>}
    {error && <div className={styles.error} role="alert"><span>{error}{loaded && " Previously loaded activity remains below."}</span>
      <button className={styles.textButton} disabled={busy} onClick={() => void load(lastRequest.current.filters, lastRequest.current.cursor)}>Retry</button></div>}
    <section className={styles.results} aria-label="Audit history events" aria-busy={busy}>
      {busy && !loaded ? <div className={styles.empty} role="status"><span className={styles.loadingMark} aria-hidden="true" />Loading audit history…</div>
        : !page.events.length ? <div className={styles.empty}><h3>{error ? "Activity unavailable" : "No events found"}</h3>
          <p>{error ? "Retry to load the audit history." : activeCount ? "Try a wider date range or clear your filters." : "Administrative changes will appear here as they happen."}</p>
          {!error && activeCount > 0 && <button className={styles.button} disabled={busy} onClick={clearFilters}>Clear filters</button>}</div>
        : <table className={styles.table}>
          <thead><tr><th>Time <span className={styles.muted}>/ PHT</span></th><th>Activity</th><th>Actor</th><th>Record</th><th><span className={styles.srOnly}>Details</span></th></tr></thead>
          <tbody>{page.events.map(event => {
            const date = dateParts(event.occurredAt);
            return <tr key={event.id}>
              <td className={styles.time}><time dateTime={new Date(event.occurredAt).toISOString()}><span>{date.date}</span><small>{date.time}</small></time></td>
              <td className={styles.activity}><strong>{readable(event.action)}</strong><small>{event.reason || "Administrative event"}</small></td>
              <td className={styles.actor}><span className={styles.mobileLabel}>Actor</span><code title={event.actorId}>{shortId(event.actorId)}</code></td>
              <td className={styles.record}><span>{entityLabels[event.entityType] ?? readable(event.entityType)}</span><code title={event.entityId}>{shortId(event.entityId)}</code></td>
              <td className={styles.rowAction}><button className={styles.detailButton} onClick={() => setSelected(event)} aria-label={`View details: ${readable(event.action)}, ${date.date} ${date.time}`}>View details <span aria-hidden="true">↗</span></button></td>
            </tr>;
          })}</tbody>
        </table>}
    </section>
    <footer className={styles.footer}>
      <span className={styles.muted} role="status">{busy && loaded ? "Updating activity…" : loaded ? `${page.events.length} ${page.events.length === 1 ? "event" : "events"} loaded${page.nextCursor ? " · More available" : " · End of results"}` : ""}</span>
      {page.nextCursor && <button className={styles.button} disabled={busy} onClick={() => void load(applied, page.nextCursor!)}>Load more events</button>}
    </footer>
    {selected && <EventDrawer event={selected} onClose={() => setSelected(null)} />}
  </main>;
}
