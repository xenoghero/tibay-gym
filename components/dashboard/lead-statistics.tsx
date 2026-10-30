"use client";
import { FormSelect } from "@/components/ui/form-select";

import { useEffect, useMemo, useState } from "react";
import { listPersons, type Person } from "@/lib/db";
import { computeLeadStatistics } from "@/lib/lead-statistics";
import { formatRangeLabel, rangeForCustom, rangeForPreset, rangeFilenameStamp, type RangePreset } from "@/lib/dates";
import { downloadCsv, toCsv } from "@/lib/csv";
import { FormInput } from "@/components/ui/form-input";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import styles from "./lead-statistics.module.css";

const periods = [["all", "All time"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["custom", "Custom range"]] as const;
type Period = typeof periods[number][0];
const percent = (count: number, total: number) => `${total ? (count / total * 100).toFixed(1) : "0.0"}%`;

export function LeadStatistics({ enabled }: { enabled: boolean }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(() => Date.now());
  const [period, setPeriod] = useState<Period>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Keep the snapshot and filters when switching tabs; fetch only after first opening Leads.
  const [opened, setOpened] = useState(false);
  if (enabled && !opened) setOpened(true);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    listPersons().then(result => { if (active) setPeople(result); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [opened, refresh]);

  const range = useMemo(() => period === "all" ? null : period === "custom"
    ? rangeForCustom(start, end) : rangeForPreset(period as RangePreset, new Date(refresh)), [period, start, end, refresh]);
  const invalid = period === "custom" && (!range || start > end);
  const stats = useMemo(() => people && !invalid ? computeLeadStatistics(people, range) : null, [people, range, invalid]);
  const loading = people === null && !error;
  const periodLabel = range ? formatRangeLabel(range) : "All time";

  function exportCsv() {
    if (!stats) return;
    downloadCsv(`tibay-gym-leads_${range ? rangeFilenameStamp(range) : "all-time"}.csv`, toCsv(
      ["Source", "Clients", "Share of all clients (%)", "Current members", "Current guests"],
      stats.sources.map(source => [source.label, source.total, percent(source.total, stats.total), source.members, source.guests]),
    ));
  }

  return <div className={`rs-finance rs-collections-report ${styles.report}`} aria-busy={loading}>
    <div className="rs-stat-section-heading"><div><h2>Leads</h2><p>See how clients discover Tibay Gym.</p></div>
      <div className="rs-stat-actions">
        <button type="button" disabled={loading} onClick={() => { setPeople(null); setError(false); setRefresh(Date.now()); }}>Refresh leads</button>
        <button type="button" disabled={!stats?.total || error} onClick={exportCsv}>Leads CSV</button>
      </div>
    </div>
    <div className={`rs-collection-toolbar ${styles.filters}`}>
      <label>Registration period <FormSelect value={period} onChange={event => setPeriod(event.target.value as Period)}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</FormSelect></label>
      {period === "custom" && <><label>From <FormInput type="date" value={start} onChange={event => setStart(event.target.value)} aria-label="Leads start date" /></label>
        <label>To <FormInput type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} aria-label="Leads end date" /></label></>}
    </div>
    {invalid ? <p role="alert">Choose both dates, with the end on or after the start.</p> : <p className="rs-collection-range">{periodLabel} · Based on profile creation date</p>}
    <details className="rs-report-definitions"><summary>How leads are counted</summary>
      <p>Each official client profile counts once, including guests created at check-in and approved accounts. Repeat check-ins do not add leads. Pending accounts are excluded. Member and guest counts reflect current profile type, not conversion during this period.</p>
      <p>Sources are self-reported. Ads and Facebook Page are separate answers; this report does not identify individual campaigns, ad spend or return on investment. Older profiles without a source appear as Not recorded.</p>
    </details>
    {error ? <p role="alert">Couldn&apos;t load leads. Check your connection and refresh leads.</p> : loading ? <LoadingSkeleton label="Loading leads" variant="cards" count={4} /> : stats && <>
      <div className="rs-finance-totals">
        <div><span>New clients</span><strong>{stats.total}</strong><small>One count per client profile</small></div>
        <div><span>Source recorded</span><strong>{percent(stats.recorded, stats.total)}</strong><small>{stats.recorded} of {stats.total} clients</small></div>
        <div><span>{stats.leaders.length > 1 ? "Top sources (tied)" : "Top source"}</span><strong className={styles.sourceName}>{stats.leaders.length > 1 ? `${stats.leaders.length} sources` : stats.leaders[0]?.label ?? "—"}</strong><small>{stats.leaders.length ? `${stats.leaders.map(source => source.label).join(", ")} · ${stats.leaders[0].total} clients${stats.leaders.length > 1 ? " each" : ""}` : "No recorded sources yet"}</small></div>
        <div><span>Not recorded</span><strong>{stats.total - stats.recorded}</strong><small>Clients without a known source</small></div>
      </div>
      {stats.total === 0 ? <div className={`rs-report-panel ${styles.empty}`}><h3>No new clients in this period</h3><p>Try a wider registration period or All time to see existing clients.</p></div> : <>
        <section className={`rs-report-panel ${styles.panel}`} aria-labelledby="lead-source-heading">
          <h3 id="lead-source-heading">Where clients found us</h3><p>Share of all {stats.total} clients in this registration period, including missing sources.</p>
          <div className={styles.bars}>{stats.sources.map(source => <div key={source.key} className={styles.source}>
            <div><span>{source.label}</span><span><strong>{source.total}</strong> <small>{percent(source.total, stats.total)}</small></span></div>
            <div className={styles.track} aria-hidden="true"><span className={source.key === "unknown" ? styles.unknown : undefined} style={{ width: percent(source.total, stats.total) }} /></div>
          </div>)}</div>
        </section>
        <section className={`rs-report-panel ${styles.panel}`} aria-labelledby="lead-breakdown-heading">
          <h3 id="lead-breakdown-heading">Source breakdown</h3><p>Compare acquisition channels across current members and guests.</p>
          <div className="rs-finance-table"><table><caption className={styles.caption}>Client acquisition by self-reported source · {periodLabel}</caption>
            <thead><tr><th scope="col">Source</th><th scope="col">Clients</th><th scope="col">Share</th><th scope="col">Members</th><th scope="col">Guests</th></tr></thead>
            <tbody>{stats.sources.map(source => <tr key={source.key}><th scope="row">{source.label}</th><td>{source.total}</td><td>{percent(source.total, stats.total)}</td><td>{source.members}</td><td>{source.guests}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">Total</th><td>{stats.total}</td><td>100.0%</td><td>{stats.sources.reduce((sum, source) => sum + source.members, 0)}</td><td>{stats.sources.reduce((sum, source) => sum + source.guests, 0)}</td></tr></tfoot>
          </table></div>
        </section>
        {stats.otherDetails.length > 0 && <section className={`rs-report-panel ${styles.panel}`} aria-labelledby="lead-others-heading"><h3 id="lead-others-heading">What “Others” includes</h3><p>Answers clients entered when choosing Others.</p><dl className={styles.details}>{stats.otherDetails.map(([detail, count]) => <div key={detail}><dt>{detail}</dt><dd>{count} {count === 1 ? "client" : "clients"}</dd></div>)}</dl></section>}
      </>}
    </>}
  </div>;
}
