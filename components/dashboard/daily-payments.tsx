"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { Charge } from "@/lib/finance/contracts";
import { ReceiptReview } from "./receipt-review";
import { PaymentDrawer, PaymentStatus, paymentDate, peso, styles } from "./payment-ui";
type DailyCharge = Charge & { customerName?: string; receiptId?: string | null; paymentMethod?: string | null; paymentStatus?: string | null };
export function DailyPayments({ refreshKey = 0, search = "", status = "all", method = "all", onReviewRequest, onConfirmed }: {
  refreshKey?: number; search?: string; status?: string; method?: string;
  onReviewRequest?: (id: string) => void; onConfirmed?: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DailyCharge[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<DailyCharge | null>(null), [reviewed, setReviewed] = useState(false);
  const [receiptCharge, setReceiptCharge] = useState<DailyCharge | null>(null);
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
  const collectionStatus = (row: DailyCharge) => row.confirmedPaymentRequestId ? "approved" : row.paymentStatus === "rejected" ? "rejected" : "pending";
  const visibleRows = rows.filter(row => (status === "all" || collectionStatus(row) === status)
    && (method === "all" || (row.paymentMethod ?? "cash") === method)
    && (!search.trim() || [row.customerName, row.personId, row.tibayTransactionNumber].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))));
  return <section className={styles.section} aria-label="Daily charges" aria-busy={loading}>
    <div className={styles.sectionHead}><h2>Daily collections</h2><span>{loading ? "Loading…" : `${visibleRows.length} on this page`}</span></div>
    <p className={styles.note}>Expected charges are separate from confirmed collections. Pending payments do not block an allowed visit.</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    {loading ? <div className={styles.loading} role="status"><p>Loading daily charges…</p>{[0, 1].map(i => <div className={styles.skeleton} key={i} aria-hidden="true" />)}</div> : !visibleRows.length ? <div className={styles.empty}><h3>{rows.length ? "No matching charges" : "No daily charges recorded yet."}</h3><p>{rows.length ? "Try another search or change the filters." : "New daily charges will appear here."}</p></div> :
      <table className={styles.table}><thead><tr>{["Customer", "Payment", "Visit date", "Collection", "Action"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.id}>
          <td><strong>{row.customerName ?? row.personId}</strong><small className={styles.method}>{row.categorySnapshot}</small></td>
          <td><strong className={styles.amount}>{peso(row.amountMinor)}</strong><small>{row.paymentMethod === "gcash" ? "GCash" : "Cash"}</small></td>
          <td><span className={styles.mobileLabel}>Visit date</span>{paymentDate(row.chargeDate)}</td>
          <td><PaymentStatus status={row.confirmedPaymentRequestId ? "confirmed" : collectionStatus(row)} />{row.paymentStatus === "rejected" && !row.confirmedPaymentRequestId && <small>Rejected — linked replacement required</small>}</td>
          <td>{row.confirmedPaymentRequestId ? onReviewRequest ? <button onClick={() => onReviewRequest(row.confirmedPaymentRequestId!)}>View payment</button> : "—" : row.paymentStatus === "rejected" ? <span className={styles.note}>Replacement required</span> : row.activePaymentRequestId && row.activePaymentRequestId !== `${row.id}-cash` ? <>
            {onReviewRequest ? <button onClick={() => onReviewRequest(row.activePaymentRequestId!)}>Review payment</button> : <><small>{row.paymentMethod ?? "Payment"} — review the linked request below to approve or reject.</small>{row.paymentMethod === "gcash" && row.receiptId && <button onClick={() => setReceiptCharge(row)}>Review GCash receipt</button>}</>}
          </> : <button className={styles.primary} disabled={busy} onClick={() => { setSelected(row); setReviewed(false); setMessage(""); }} aria-label="Review cash received">Review cash</button>}</td>
        </tr>)}</tbody>
      </table>}
    {cursor && <div className={styles.pagination}><span>More daily charges available</span><button disabled={busy || loading} onClick={() => load(cursor).catch(e => setMessage(e.message))}>Next 50 charges →</button></div>}
    {receiptCharge?.receiptId && <PaymentDrawer title="GCash receipt" onClose={() => setReceiptCharge(null)}><ReceiptReview key={receiptCharge.receiptId} receiptId={receiptCharge.receiptId} expectedAmountMinor={receiptCharge.amountMinor} /></PaymentDrawer>}
    {selected && <PaymentDrawer title="Confirm cash collection" busy={busy} onClose={() => setSelected(null)}>
      <PaymentStatus status="pending" /><div className={styles.detailAmount}>{peso(selected.amountMinor)}</div>
      <dl className={styles.details}><div><dt>Customer</dt><dd>{selected.customerName ?? selected.personId}</dd></div><div><dt>Visit date</dt><dd>{paymentDate(selected.chargeDate)}</dd></div><div><dt>Category</dt><dd className={styles.method}>{selected.categorySnapshot}</dd></div><div><dt>Tibay number</dt><dd>{selected.tibayTransactionNumber}</dd></div></dl>
      <p>Confirm only after checking the cash received for this daily session.</p>
      <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /> I received and checked this cash amount.</label>
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.actions}><button className={styles.primary} disabled={busy || !reviewed} onClick={() => void confirm()}>{busy ? "Confirming…" : "Confirm cash received"}</button><button disabled={busy} onClick={() => setSelected(null)}>Cancel review</button></div>
    </PaymentDrawer>}
  </section>;
}
