"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReportDateSheet } from "./report-date-sheet";
import { auth } from "@/lib/firebase";
import { philippineDate } from "@/lib/finance/rules";
import type { FinanceReport } from "@/lib/finance/report";

type Report = FinanceReport & { revision: string; nextCursor: string | null; generatedAt: number; financialCutoverAt: number | null };
// Memory only, scoped to the signed-in User object and Philippine date. Returning
// to Overview can reuse a recent snapshot without persisting financial data.
const compactReports = new WeakMap<object, { date: string; report: Report; fetchedAt: number }>();
const refreshInterval = 60_000;
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
const labels = { daily_session: "Daily sessions", renewal: "Renewals", new_membership: "New memberships" };
const messages: Record<string, string> = {
  "report-record-limit": "This report has too many source records. Choose a shorter period. If the outstanding queue alone exceeds the limit, contact the system administrator.",
  "financial-data-conflict": "Some financial records need reconciliation. Contact the system administrator; totals have been withheld.",
  "invalid-report-range": "Choose valid dates in order, covering at most 366 days.",
};
async function loadReport(query: string, signal: AbortSignal): Promise<Report> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to view collections.");
  const response = await fetch(`/api/finance/report?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(messages[body.error] ?? "Could not load collections. Check your connection and retry.");
  return body;
}
export function FinanceStatistics({ compact = false }: { compact?: boolean }) {
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [period, setPeriod] = useState("day"), [date, setDate] = useState(() => philippineDate(Date.now()));
  const [from, setFrom] = useState(date), [through, setThrough] = useState(date);
  const [cached] = useState(() => compact && auth.currentUser ? compactReports.get(auth.currentUser) : undefined);
  const initialReport = cached?.date === date ? cached.report : null;
  const [report, setReport] = useState<Report | null>(initialReport), [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !initialReport || !cached || Date.now() - cached.fetchedAt >= refreshInterval), [refresh, setRefresh] = useState(0), [cursor, setCursor] = useState("");
  const [pageLoading, setPageLoading] = useState(false), [pageError, setPageError] = useState("");
  const generation = useRef(0);
  const query = new URLSearchParams(compact ? { period: "day", date } : { period, date, from, through }).toString();
  useEffect(() => {
    const user = auth.currentUser;
    const snapshot = compact && user ? compactReports.get(user) : undefined;
    if (refresh === 0 && snapshot?.date === date && Date.now() - snapshot.fetchedAt < refreshInterval) return;
    const controller = new AbortController();
    generation.current++;
    loadReport(query, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])).then(value => {
      if (controller.signal.aborted) return;
      if (compact && user) compactReports.set(user, { date, report: value, fetchedAt: Date.now() });
      setReport(value); setCursor(value.nextCursor ?? ""); setError(""); setPageError("");
    }).catch(reason => { if (!controller.signal.aborted) {
      if (compact && user) compactReports.delete(user);
      setError(reason instanceof Error ? reason.message : "Could not load collections.");
    } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [query, refresh, compact, date]);
  useEffect(() => {
    if (!compact) return;
    const reload = () => {
      if (document.visibilityState === "hidden") return;
      const nextDate = philippineDate(Date.now());
      if (nextDate !== date) setReport(null);
      setDate(nextDate);
      setLoading(true); setRefresh(value => value + 1);
    };
    const timer = window.setInterval(reload, refreshInterval);
    return () => { window.clearInterval(timer); };
  }, [compact, date]);
  function changed(update: () => void) { update(); setReport(null); setError(""); setPageError(""); setLoading(true); }
  async function more() {
    const selectedQuery = query, selectedReport = report, selectedGeneration = generation.current;
    if (!selectedReport || !cursor) return;
    setPageLoading(true); setPageError("");
    try {
      const next = await loadReport(`${selectedQuery}&cursor=${encodeURIComponent(cursor)}`, AbortSignal.timeout(30_000));
      if (generation.current !== selectedGeneration) return;
      // Paging is a fresh consistent snapshot. Refresh instead of merging changed source records.
      if (next.revision !== selectedReport.revision) throw new Error("Collections changed. Refresh the report before continuing.");
      setReport(current => current !== selectedReport ? current : { ...current, ledger: [...current.ledger, ...next.ledger] });
      setCursor(next.nextCursor ?? "");
    } catch (reason) { if (generation.current === selectedGeneration) setPageError(reason instanceof Error ? reason.message : "Could not load more records."); }
    finally { setPageLoading(false); }
  }
  const totals = report?.totals;
  if (compact) return <section className="rs-finance rs-finance-compact" aria-label="Today's collections" aria-busy={loading}>
    <div className="rs-finance-heading"><h2>Today’s collections</h2><button type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Refresh collections</button></div>
    <div className="rs-ov-collections-scroll" role="region" aria-label="Today's collection details" tabIndex={0}>
    {loading && (!report ? <LoadingSkeleton label="Loading collections…" variant="cards" count={compact ? 3 : 4} /> : <LoadingSkeleton label="Updating collections…" variant="inline" />)}
    {error && <p role="alert">{error}</p>}
    {!error && report && totals && <>
      <div className="rs-ov-collection-hero"><span>Confirmed collections</span><strong>{money(totals.confirmedMinor)}</strong><small>{totals.confirmedCount} confirmed transactions · Updated {new Date(report.generatedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</small></div>
      <dl className="rs-ov-collection-lines">
        <div><dt>Expected charges / recorded purchases</dt><dd>{money(totals.expectedMinor)}<small>{totals.expectedCount} charges / purchases</small></dd></div>
        <div><dt>Pending daily payments</dt><dd>{money(totals.pendingDailyMinor)}</dd></div>
        <div><dt>Pending membership requests</dt><dd>{money(totals.pendingRenewalMinor)}</dd></div>
      </dl>
      <details className="rs-ov-collection-details"><summary>Collection breakdown &amp; definitions</summary>
        <dl className="rs-ov-collection-lines">{report.breakdown.map(row => <div key={row.kind}><dt>{labels[row.kind]}<small>{row.expectedCount} charges / purchases</small></dt><dd>{money(row.expectedMinor)}</dd></div>)}</dl>
        <p>Expected includes daily charges and approved membership purchases. Confirmed uses confirmation dates. Pending membership requests are not recorded sales.</p>
        <p><strong>All open renewal requests: {money(report.outstanding.renewalMinor)}</strong> (all dates).</p>
        <p>Philippine date · {report.range.from}</p>
      </details>
      {!report.financialCutoverAt && <p>Financial cutover has not been set in Settings. Historical attendance is not backfilled as payments.</p>}
    </>}
    </div>
  </section>;
  const filters = <>
    <label>Period<select value={period} onChange={event => changed(() => setPeriod(event.target.value))}><option value="day">Selected day</option><option value="week">Monday–Sunday week</option><option value="month">Calendar month</option><option value="custom">Date range</option></select></label>
    {period !== "custom" ? <label>Date<input type="date" required value={date} onChange={event => changed(() => setDate(event.target.value))} /></label> : <><label>From<input type="date" required value={from} onChange={event => changed(() => setFrom(event.target.value))} /></label><label>Through<input type="date" required min={from} value={through} onChange={event => changed(() => setThrough(event.target.value))} /></label></>}
  </>;
  return <section className="rs-finance rs-collections-report" aria-label="Financial statistics" aria-busy={loading}>
    <div className="rs-stat-section-heading"><div><h2>Collections</h2><p>Recorded charges, confirmed payments and pending requests.</p></div>
      <Link className="rs-stat-link" href="/dashboard/payments">Review payments <span aria-hidden="true">↗</span></Link>
    </div>
    <div className="rs-collection-toolbar">
      <div className="rs-finance-filters rs-collection-desktop-filters">{filters}</div>
      <button className="rs-collection-date-trigger" type="button" aria-haspopup="dialog" aria-expanded={dateSheetOpen} onClick={() => setDateSheetOpen(true)}><span>Date range</span><strong>{period === "custom" ? `${from} – ${through}` : `${period === "day" ? "Day" : period === "week" ? "Week of" : "Month of"} · ${date}`}</strong><span aria-hidden="true">⌄</span></button>
      <div className="rs-collection-refresh"><small>{!error && report ? `Updated ${new Date(report.generatedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}` : "Philippine time"}</small><button type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Refresh collections</button></div>
    </div>
    <ReportDateSheet open={dateSheetOpen} onClose={() => setDateSheetOpen(false)}><div className="rs-finance-filters">{filters}</div></ReportDateSheet>
    {loading && (!report ? <LoadingSkeleton label="Loading collections…" variant="cards" count={compact ? 3 : 4} /> : <LoadingSkeleton label="Updating collections…" variant="inline" />)}
    {error && <p className="rs-report-error" role="alert">{error}</p>}
    {!error && report && totals && <>
      <p className="rs-collection-range">{report.range.from}{report.range.through !== report.range.from ? ` through ${report.range.through}` : ""} · Philippine dates · Weeks start Monday</p>
      <div className="rs-finance-totals">
        <Figure label="Confirmed collections" amount={totals.confirmedMinor} detail={`${totals.confirmedCount} confirmed transactions`} />
        <Figure label="Expected charges / recorded purchases" amount={totals.expectedMinor} detail={`${totals.expectedCount} charges / purchases`} />
        <Figure label="Pending daily payments" amount={totals.pendingDailyMinor} detail="Current requests for visits in this period" />
        <Figure label="Pending membership requests" amount={totals.pendingRenewalMinor} detail="Current requests submitted for charges in this period" />
      </div>
      <div className="rs-collection-analysis">
        <div className="rs-report-panel"><CollectionTrend report={report} /></div>
        <div className="rs-report-panel rs-collection-breakdown"><h3>Purchase breakdown</h3><p>Expected charges and recorded purchases in this period.</p>
          <div className="rs-finance-split">{report.breakdown.map(row => <div key={row.kind}><span>{labels[row.kind]}</span><strong>{money(row.expectedMinor)}</strong><small>{row.expectedCount} charges / purchases · {money(row.confirmedMinor)} confirmed ({row.confirmedCount})</small></div>)}</div>
          <div className="rs-collection-methods"><span>Confirmed by method</span><div><span>Cash</span><strong>{money(totals.cashMinor)}</strong></div><div><span>GCash</span><strong>{money(totals.gcashMinor)}</strong></div></div>
        </div>
      </div>
      <details className="rs-report-definitions"><summary>How totals work</summary>
        <p>Expected includes daily charges and approved membership purchases on their recorded purchase date. Pending membership requests are separate. Confirmed collections use the payment confirmation date; delayed confirmations may belong to earlier visits. The difference between expected and confirmed is not an unpaid balance.</p>
        <p>Pending in this period: Cash {money(totals.pendingCashMinor)} · GCash {money(totals.pendingGcashMinor)} ({totals.pendingCount} requests).</p>
        <p>Each record is one charge; its latest linked request determines its status. “No submission” means no payment request is linked. Categories and prices reflect the original purchase.</p>
      </details>
      <aside className="rs-collection-outstanding" aria-label="Outstanding requests across all dates"><div><strong>Open requests · All dates</strong><p>Separate from the selected reporting period.</p></div>
        <dl><div><dt>Renewals</dt><dd>{money(report.outstanding.renewalMinor)}</dd></div><div><dt>New memberships</dt><dd>{money(report.outstanding.newMembershipMinor)}</dd></div><div><dt>Daily payments</dt><dd>{money(report.outstanding.dailyMinor)}</dd></div></dl>
      </aside>
      {!report.financialCutoverAt && <p>Financial cutover has not been set in Settings. Historical attendance is not backfilled as payments.</p>}
      <div className="rs-report-panel rs-collection-records"><div className="rs-records-heading"><h3>Charge and purchase records</h3><small>{report.ledger.length} loaded</small></div>
        {!report.ledger.length ? <div className="rs-report-empty"><strong>No records in this period</strong><p>Choose a different date range to view charges and purchases.</p></div> : <div role="region" aria-label="Financial records" tabIndex={0}>
          <div className="rs-finance-table rs-ledger-desktop"><table><thead><tr>{["Tibay number / customer ID", "Type / category", "Amount", "Method / status", "Purchase / visit date", "Confirmation (Manila)", "In selected period"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{report.ledger.map(row => <tr key={row.id}><td>{row.transactionNumber}<small>{row.personId}</small></td><td>{labels[row.kind]}<small>{row.category}</small></td><td>{money(row.amountMinor)}</td><td>{row.method ?? "—"}<small className="rs-payment-status">{row.status}</small></td><td>{row.purchaseDate}</td><td>{row.confirmedAt === null ? "—" : new Date(row.confirmedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>{[row.expectedInPeriod && "Expected", row.confirmedInPeriod && "Confirmed"].filter(Boolean).join(" · ") || "Submission only"}</td></tr>)}</tbody></table></div>
          <div className="rs-ledger-mobile">{report.ledger.map(row => <details key={row.id}><summary><span><strong>{labels[row.kind]}</strong><small>{row.transactionNumber}</small></span><span><strong>{money(row.amountMinor)}</strong><small>{row.status} · Details</small></span></summary><dl>
            <div><dt>Customer ID</dt><dd>{row.personId}</dd></div><div><dt>Category</dt><dd>{row.category}</dd></div><div><dt>Payment method</dt><dd>{row.method ?? "—"}</dd></div><div><dt>Purchase / visit</dt><dd>{row.purchaseDate}</dd></div><div><dt>Confirmed (Manila)</dt><dd>{row.confirmedAt === null ? "Not confirmed" : new Date(row.confirmedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</dd></div><div><dt>In selected period</dt><dd>{[row.expectedInPeriod && "Expected", row.confirmedInPeriod && "Confirmed"].filter(Boolean).join(" · ") || "Submission only"}</dd></div>
          </dl></details>)}</div>
        </div>}
        {pageLoading && <LoadingSkeleton label="Loading records…" />}
        {pageError && <p role="alert">{pageError}</p>}{cursor && <button type="button" disabled={pageLoading} onClick={() => void more()}>{pageLoading ? "Loading records…" : "Load more records"}</button>}
      </div>
    </>}
  </section>;
}

function Figure({ label, amount, detail }: { label: string; amount: number; detail: string }) {
  return <div><span>{label}</span><strong>{money(amount)}</strong><small>{detail}</small></div>;
}
function CollectionTrend({ report }: { report: Report }) {
  const max = Math.max(1, ...report.trend.flatMap(day => [day.expectedMinor, day.confirmedMinor]));
  const singleDay = report.trend.length === 1;
  const width = 900 / Math.max(1, report.trend.length);
  return <div><h3>{singleDay ? "Daily comparison" : "Collection trend"}</h3><p>Expected charges and confirmed payments, by Philippine date.</p>
    <div className="rs-chart-legend"><span><i />Expected</span><span><i />Confirmed</span></div>
    {singleDay ? <div className="rs-daily-comparison">{[{ label: "Expected", amount: report.trend[0].expectedMinor }, { label: "Confirmed", amount: report.trend[0].confirmedMinor }].map(item => <div key={item.label}><div><span>{item.label}</span><strong>{money(item.amount)}</strong></div><div className={`rs-comparison-track rs-comparison-${item.label.toLowerCase()}`}><span style={{ width: `${item.amount / max * 100}%` }} /></div></div>)}</div> : <svg className="rs-finance-chart" role="img" aria-label="Daily expected and confirmed collections; exact amounts in the table below" viewBox="0 0 900 220">
      {[0, 1, 2].map(tick => <g key={tick}><line x1="0" x2="900" y1={35 + tick * 70} y2={35 + tick * 70} stroke="var(--rs-line)" strokeDasharray="4 4" /><text x="0" y={29 + tick * 70} fill="var(--rs-muted)" fontSize="12">{money(max * (1 - tick / 2))}</text></g>)}
      {report.trend.map((day, index) => <g key={day.date}><title>{day.date}: expected {money(day.expectedMinor)}, confirmed {money(day.confirmedMinor)}</title><rect x={index * width + width * .15} y={175 - day.expectedMinor / max * 140} width={Math.min(24, width * .3)} height={day.expectedMinor / max * 140} fill="var(--rs-muted)" /><rect x={index * width + width * .5} y={175 - day.confirmedMinor / max * 140} width={Math.min(24, width * .3)} height={day.confirmedMinor / max * 140} fill="var(--rs-accent)" />{index % Math.max(1, Math.ceil(report.trend.length / 5)) === 0 && <text x={index * width + width * .5} y="207" textAnchor="middle" fill="var(--rs-muted)" fontSize="13">{day.date.slice(5)}</text>}</g>)}
    </svg>}
    <details className="rs-exact-amounts"><summary>Daily amounts and transaction counts</summary><div className="rs-finance-table" role="region" aria-label="Daily collection amounts" tabIndex={0}><table><thead><tr><th>Date</th><th>Expected</th><th>Confirmed</th><th>Confirmed count</th></tr></thead><tbody>{report.trend.map(day => <tr key={day.date}><td>{day.date}</td><td>{money(day.expectedMinor)}</td><td>{money(day.confirmedMinor)}</td><td>{day.confirmedCount}</td></tr>)}</tbody></table></div></details></div>;
}
