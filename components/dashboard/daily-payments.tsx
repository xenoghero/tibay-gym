"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { Charge } from "@/lib/finance/contracts";
import { DailyPaymentHistory } from "./daily-payment-history";
import { PriceBreakdown } from "@/components/people/voucher-entry";
import { PaymentDrawer, PaymentStatus, paymentDate, peso, styles } from "./payment-ui";
type DailyCharge = Charge & { customerName?: string; receiptId?: string | null; paymentMethod?: string | null; paymentStatus?: string | null; gcashReference?: string | null };
const collectionStatus = (row: DailyCharge) => row.confirmedPaymentRequestId ? "approved" : row.paymentStatus === "rejected" ? "rejected" : row.activePaymentRequestId ? "pending" : "awaiting";
const collectionLabel = (row: DailyCharge) => ({ approved: "Collected", rejected: "Payment rejected", pending: "Pending review", awaiting: "Awaiting payment" })[collectionStatus(row)];
const needsCashConfirmation = (row: DailyCharge) => !row.confirmedPaymentRequestId && row.paymentStatus !== "rejected" && (!row.activePaymentRequestId || row.activePaymentRequestId === `${row.id}-cash`);
export function DailyPayments({ refreshKey = 0, search = "", status = "all", method = "all", onReviewRequest, onConfirmed, disabled = false }: {
  refreshKey?: number; search?: string; status?: string; method?: string; disabled?: boolean;
  onReviewRequest?: (id: string) => void; onConfirmed?: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DailyCharge[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<DailyCharge | null>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  async function load(next?: string) {
    if (!user) return;
    const request = ++sequence.current; setLoading(true);
    try {
      const response = await fetch(`/api/finance/daily${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Could not load daily charges. Try again.");
      const data = await response.json();
      if (request === sequence.current) { setRows(data.charges); setCursor(data.nextCursor); setMessage(""); }
    } finally { if (request === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    if (user) user.getIdToken().then(token => fetch("/api/finance/daily", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Could not load daily charges. Try again."); const data = await response.json(); if (active && request === sequence.current) { setRows(data.charges); setCursor(data.nextCursor); } })
      .catch(e => { if (active && request === sequence.current) setMessage(e.message); }).finally(() => { if (active && request === sequence.current) setLoading(false); });
    return () => { active = false; };
  }, [user, refreshKey]);
  async function confirm() {
    if (!user || !selected || !reviewed || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/finance/daily", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ chargeId: selected.id, expectedAmountMinor: selected.amountMinor, reviewed: true }) });
      if (!response.ok) throw new Error("Could not confirm cash collection. Refresh and review the charge before retrying.");
      setSelected(null); setReviewed(false); await load(); onConfirmed?.(); setMessage("Cash collection confirmed. Membership and attendance are unchanged.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not confirm cash collection."); }
    finally { setBusy(false); }
  }
  const visibleRows = rows.filter(row => (status === "all" || collectionStatus(row) === status)
    && (method === "all" || (row.paymentMethod ?? "cash") === method)
    && (!search.trim() || [row.customerName, row.personId, row.tibayTransactionNumber, row.gcashReference].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))));
  return <section className={styles.section} aria-label="Daily payments" aria-busy={loading}>
    <div className={styles.sectionHead}><h2>Daily payments</h2><span>{loading ? "Loading…" : `${visibleRows.length} on this page`}</span></div>
    <p className={styles.note}>One row per daily visit. Confirm cash received or review a submitted payment; open details for payment history.</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    {loading ? <LoadingSkeleton label="Loading daily charges…" count={5} /> : !visibleRows.length ? <div className={styles.empty}><h3>{rows.length ? "No matching charges" : "No daily charges recorded yet."}</h3><p>{rows.length ? "Try another search or change the filters." : "New daily charges will appear here."}</p></div> :
      <table className={styles.table}><thead><tr>{["Customer", "Payment", "Visit date", "Status", "Action"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.id}>
          <td><strong>{row.customerName ?? row.personId}</strong><small className={styles.method}>{row.categorySnapshot}</small></td>
          <td><strong className={styles.amount}>{peso(row.amountMinor)}</strong><small>{row.paymentMethod === "gcash" ? "GCash" : "Cash"}</small></td>
          <td><span className={styles.mobileLabel}>Visit date</span>{paymentDate(row.chargeDate)}</td>
          <td><PaymentStatus status={collectionStatus(row)} label={collectionLabel(row)} />{row.paymentStatus === "rejected" && !row.confirmedPaymentRequestId && <small>Linked replacement required</small>}</td>
          <td>{needsCashConfirmation(row) ? <button className={styles.primary} disabled={busy || disabled} onClick={() => { setSelected(row); setReviewed(false); setMessage(""); }} aria-label={`Confirm cash for ${row.customerName ?? row.personId}`}>Confirm cash</button> : !row.confirmedPaymentRequestId && row.paymentStatus !== "rejected" && onReviewRequest ? <button className={styles.primary} disabled={busy || disabled} onClick={() => onReviewRequest(row.activePaymentRequestId!)}>Review payment</button> : <button disabled={busy || disabled} onClick={() => { setSelected(row); setMessage(""); }}>View details</button>}</td>
        </tr>)}</tbody>
      </table>}
    <div className={styles.pagination}><span>Search and filters apply to this loaded page.</span>{cursor && <button disabled={busy || disabled || loading} onClick={() => load(cursor).catch(e => setMessage(e.message))}>Next 50 charges →</button>}</div>
    {selected && <PaymentDrawer title={needsCashConfirmation(selected) ? "Confirm cash collection" : "Daily payment details"} busy={busy} onClose={() => setSelected(null)}>
      <PaymentStatus status={collectionStatus(selected)} label={collectionLabel(selected)} /><div className={styles.detailAmount}>{peso(selected.amountMinor)}</div>
      {selected.voucherSnapshot && <PriceBreakdown quote={selected} />}
      <dl className={styles.details}><div><dt>Customer</dt><dd>{selected.customerName ?? selected.personId}</dd></div><div><dt>Visit date</dt><dd>{paymentDate(selected.chargeDate)}</dd></div><div><dt>Category</dt><dd className={styles.method}>{selected.categorySnapshot}</dd></div><div><dt>Tibay number</dt><dd>{selected.tibayTransactionNumber}</dd></div></dl>
      <DailyPaymentHistory key={selected.id} chargeId={selected.id} />
      {selected.paymentStatus === "rejected" && <p>A linked replacement payment is required before this visit can be marked as collected.</p>}
      {needsCashConfirmation(selected) && <>
      <p>Confirm only after checking the cash received for this daily session.</p>
      <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /> I received and checked this cash amount.</label>
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={busy || !reviewed} onClick={() => void confirm()}>{busy ? "Confirming…" : "Confirm cash received"}</button><button disabled={busy} onClick={() => setSelected(null)}>Cancel review</button></div>
      </>}
    </PaymentDrawer>}
  </section>;
}
