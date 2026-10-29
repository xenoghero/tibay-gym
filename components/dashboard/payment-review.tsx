"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { Charge, PaymentRequest, Coverage } from "@/lib/finance/contracts";
import { ReceiptReview } from "./receipt-review";
import { DailyPayments } from "./daily-payments";
import { PaymentDrawer, PaymentStatus, paymentDate, peso, styles } from "./payment-ui";
import { PriceBreakdown } from "@/components/people/voucher-entry";
import { SettingsConfirm } from "./settings-confirm";
interface Row { payment: PaymentRequest; charge: Charge; customer: { id: string; name: string }; gcashReference?: string | null }
interface Preview { payment: PaymentRequest; charge: Charge; customer: { id: string; name: string }; coverage: Coverage | null; previewToken: string; membershipChanged: boolean }
export function PaymentReview() {
  const { user } = useAuth();
  const [kind, setKind] = useState("membership"), [rows, setRows] = useState<Row[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Preview | null>(null), [reviewed, setReviewed] = useState(false), [ack, setAck] = useState(false), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [method, setMethod] = useState("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [closing, setClosing] = useState(false), [closeReason, setCloseReason] = useState("");
  const requestSequence = useRef(0);
  async function headers() { return { Authorization: `Bearer ${await user?.getIdToken()}` }; }
  async function list(next?: string) {
    const sequence = ++requestSequence.current; setLoading(true);
    try {
      const response = await fetch(`/api/finance/review?kind=${kind}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { headers: await headers(), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Could not load payment requests. Try again.");
      const result = await response.json(); if (sequence === requestSequence.current) { setRows(result.records); setCursor(result.nextCursor); setMessage(""); }
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }
  async function preview(id: string) {
    setReviewed(false); setAck(false); setReason(""); setBusy(true); setReviewLoading(true);
    try {
      // Final records remain inspectable even after their customer profile is deleted.
      const finalRow = rows.find(row => row.payment.id === id && row.payment.status !== "pending");
      if (finalRow) {
        setSelected({ ...finalRow, coverage: finalRow.payment.appliedCoverage, membershipChanged: false, previewToken: "" });
        return;
      }
      const response = await fetch(`/api/finance/review?id=${encodeURIComponent(id)}`, { headers: await headers(), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("This request cannot be reviewed yet. Verify its profile or refresh the request.");
      setSelected(await response.json());
    } finally { setBusy(false); setReviewLoading(false); }
  }
  useEffect(() => {
    let active = true;
    const sequence = ++requestSequence.current;
    if (user) user.getIdToken().then(token => fetch(`/api/finance/review?kind=${kind}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Could not load payment requests. Try again."); const result = await response.json(); if (active && sequence === requestSequence.current) { setRows(result.records); setCursor(result.nextCursor); setMessage(""); } })
      .catch(e => { if (active && sequence === requestSequence.current) setMessage(e.message); })
      .finally(() => { if (active && sequence === requestSequence.current) setLoading(false); });
    return () => { active = false; };
  }, [user, kind]);
  async function decide(decision: "approve" | "reject") {
    if (!selected || !reviewed || busy) return;
    if (decision === "reject" && !reason.trim()) { setMessage("Enter a rejection reason."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/finance/review", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() },
        body: JSON.stringify({ paymentRequestId: selected.payment.id, decision, reviewed: true, reason, previewToken: selected.previewToken, acknowledgeMembershipChange: ack }) });
      if (!response.ok) { await preview(selected.payment.id); throw new Error("Decision not applied. Review refreshed coverage and receipt values; check any reference conflict or amount mismatch before trying again."); }
      setSelected(null); setReviewed(false); setReason(""); setRefreshKey(value => value + 1); await list(); setMessage(decision === "approve" ? "Payment confirmed and applicable membership coverage applied once." : "Payment rejected. Attendance and membership are preserved.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not confirm the decision. Refresh before retrying."); }
    finally { setBusy(false); }
  }
  async function cleanupEvidence() {
    if (!user || busy) return;
    setBusy(true); setMessage("");
    try {
      const auth = await headers();
      const receipts = await fetch("/api/receipts/worker", { method: "POST", headers: auth });
      if (!receipts.ok) throw new Error("Receipt cleanup could not finish. Saved work will be retried on the next run.");
      const photos = await fetch("/api/images/cleanup", { method: "POST", headers: auth });
      if (!photos.ok) throw new Error("Receipt maintenance finished; photo cleanup could not finish. Try again.");
      setSelected(null);
      setMessage("Retention maintenance finished. Eligible evidence and photos were removed; protected records were kept. Larger backlogs may need another run.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cleanup could not finish."); }
    finally { setBusy(false); }
  }
  async function closePurchase() {
    if (!selected || busy || !closeReason.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/finance/purchases", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() },
        body: JSON.stringify({ action: "abandon", chargeId: selected.charge.id, paymentRequestId: selected.payment.id, reason: closeReason, confirmed: true }) });
      if (!response.ok) throw new Error("Could not close this purchase. Refresh to check whether payment was already approved.");
      setClosing(false); setSelected(null); setCloseReason(""); await list(); setMessage("Membership request closed. Its voucher reservation was released; history is preserved.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not close this purchase."); }
    finally { setBusy(false); }
  }
  const visibleRows = rows.filter(row => {
    const query = search.trim().toLowerCase();
    return (status === "all" || row.payment.status === status) && (method === "all" || row.payment.method === method)
      && (!query || [row.customer.name, row.customer.id, row.charge?.tibayTransactionNumber, row.gcashReference, row.payment.gcashReferenceSnapshot].some(value => value?.toLowerCase().includes(query)));
  });
  async function refresh() { setRefreshKey(value => value + 1); await list().catch(e => setMessage(e.message)); }
  return <main className={styles.page}>
    <header className={styles.head}>
      <div><div className={styles.kicker}>Payments & collections</div><h1 className={styles.title}>Payment review</h1></div>
    </header>
    <div className={styles.tabs} role="group" aria-label="Payment type">
      {[["membership", "Renewal requests"], ["daily_session", "Daily payments"]].map(([value, label]) => <button aria-pressed={kind === value} key={value} disabled={busy} onClick={() => { if (kind !== value) { setKind(value); setSelected(null); setRows([]); setCursor(null); setMessage(""); setLoading(true); setSearch(""); setStatus("all"); setMethod("all"); } }}>{label}</button>)}
    </div>
    <div className={styles.toolbar}>
      <label className={styles.search}>Search this page<input type="search" placeholder="Name, customer ID or reference" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved / collected</option><option value="rejected">Rejected</option></select></label>
      <label>Method<select value={method} onChange={e => setMethod(e.target.value)}><option value="all">All methods</option><option value="cash">Cash</option><option value="gcash">GCash</option></select></label>
      <button disabled={busy || loading} onClick={() => void refresh()} aria-label="Refresh requests">↻ Refresh</button>
      <details className={styles.maintenance}><summary>Maintenance</summary><div className={styles.maintenanceMenu}><p>Remove eligible receipt evidence and photos. Protected records are kept.</p><button disabled={busy} onClick={() => void cleanupEvidence()}>Run retention cleanup</button></div></details>
    </div>
    {message && <p className={styles.message} role="status">{message}</p>}
    <div className={styles.scroll}>
      {kind === "daily_session" && <DailyPayments key={refreshKey} search={search} status={status} method={method} onConfirmed={() => void list().catch(e => setMessage(e.message))} onReviewRequest={id => void preview(id).catch(e => setMessage(e.message))} />}
      <section className={styles.section} aria-label="Payment requests" aria-busy={loading}>
        <div className={styles.sectionHead}><h2>{kind === "membership" ? "Renewal requests" : "Daily payment requests"}</h2><span>{loading ? "Loading…" : `${visibleRows.length} on this page`}</span></div>
        {kind === "daily_session" && <p className={styles.note}>Review submitted payments here. Confirm walk-in cash in the charge list above.</p>}
        {loading ? <div className={styles.loading} role="status"><p>Loading payment requests…</p>{[0, 1, 2].map(i => <div className={styles.skeleton} key={i} aria-hidden="true" />)}</div> : <>
          {!visibleRows.length ? <div className={styles.empty}><h3>{rows.length ? "No matching requests" : "No requests on this page."}</h3><p>{rows.length ? "Try another search or change the filters." : "Refresh to check for new payment requests."}</p></div> :
          <table className={styles.table}><thead><tr>{["Customer", "Payment", "Coverage", "Submitted", "Status", "Action"].map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead>
            <tbody>{visibleRows.map(row => <tr key={row.payment.id}>
              <td><strong>{row.customer.name}</strong><small className={styles.method}>{row.charge?.categorySnapshot ?? "—"}</small></td>
              <td><strong className={styles.amount}>{peso(row.payment.amountMinor)}</strong><small>{row.payment.method === "gcash" ? "GCash" : "Cash"}</small></td>
              <td><span className={styles.mobileLabel}>Coverage</span>{(row.payment.appliedCoverage ?? row.charge?.requestedCoverage)?.expiryDate ? `Until ${paymentDate((row.payment.appliedCoverage ?? row.charge?.requestedCoverage)!.expiryDate)}` : "Daily session"}</td>
              <td><span className={styles.mobileLabel}>Submitted</span>{paymentDate(row.payment.submittedAt)}<small>{new Date(row.payment.submittedAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}</small></td>
              <td><PaymentStatus status={row.payment.status} /></td>
              <td><button disabled={busy} className={row.payment.status === "pending" ? styles.primary : undefined} aria-label={`Review payment for ${row.customer.name}`} onClick={() => void preview(row.payment.id).catch(e => setMessage(e.message))}>Review</button></td>
            </tr>)}</tbody>
          </table>}
        </>}
        <div className={styles.pagination}><span>Search and filters apply to this loaded page.</span>{cursor && <button disabled={busy || loading} onClick={() => list(cursor).catch(e => setMessage(e.message))}>Next 50 requests →</button>}</div>
      </section>
    </div>
    {reviewLoading && !selected && <p className={styles.message} role="status">Opening payment details…</p>}
    {selected && <PaymentDrawer title={selected.customer.name} busy={busy} onClose={() => setSelected(null)}>
      <PaymentStatus status={selected.payment.status} /><div className={styles.detailAmount}>{peso(selected.payment.amountMinor)}</div>
      {selected.charge.voucherSnapshot && <PriceBreakdown quote={selected.charge} />}
      <dl className={styles.details}>
        <div><dt>Payment method</dt><dd>{selected.payment.method === "gcash" ? "GCash" : "Cash"}</dd></div>
        <div><dt>Category</dt><dd className={styles.method}>{selected.charge.categorySnapshot}</dd></div>
        <div><dt>Tibay number</dt><dd>{selected.charge.tibayTransactionNumber}</dd></div>
        <div><dt>Submitted</dt><dd>{paymentDate(selected.payment.submittedAt)}</dd></div>
        <div><dt>Payment type</dt><dd className={styles.method}>{selected.charge.kind.replaceAll("_", " ")}</dd></div>
        <div><dt>GCash reference</dt><dd>{selected.payment.gcashReferenceSnapshot ?? "See receipt review"}</dd></div>
      </dl>
      {selected.coverage && <p className={styles.message}>Final coverage if approved now: {selected.coverage.startDate} to {selected.coverage.expiryDate}</p>}
      {selected.payment.receiptId && <ReceiptReview key={selected.payment.receiptId} receiptId={selected.payment.receiptId} expectedAmountMinor={selected.payment.amountMinor} onReviewed={() => void preview(selected.payment.id).catch(e => setMessage(e.message))} />}
      {selected.charge.abandonedAt ? <p className={styles.message}>Closed {paymentDate(selected.charge.abandonedAt)}. {selected.charge.abandonmentReason} This purchase cannot be approved or corrected.</p> : selected.payment.status === "pending" ? <>
        <h3>Review checklist</h3>
        {selected.membershipChanged && <label><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} /> Membership changed since submission. I reviewed and accept the refreshed coverage.</label>}
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /> I reviewed the amount, evidence and final coverage.</label>
        <label>Rejection reason (required to reject)<textarea rows={3} value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
        {message && <p className={styles.message} role="status">{message}</p>}
        <div className={styles.actions}><button className={styles.primary} disabled={busy || !reviewed || (selected.membershipChanged && !ack)} onClick={() => void decide("approve")}>{busy ? "Working…" : "Approve — payment received"}</button><button className={styles.danger} disabled={busy || !reviewed} onClick={() => void decide("reject")}>Reject request</button></div>
      </> : <p>Final outcome: {selected.payment.status}. {selected.payment.rejectionReason}</p>}
      {!selected.charge.abandonedAt && selected.payment.status !== "approved" && selected.charge.kind !== "daily_session" && <button className={styles.danger} disabled={busy} onClick={() => { setCloseReason(""); setClosing(true); }}>Close abandoned membership request</button>}
      {closing && <SettingsConfirm title="Close this membership request?" label="Close request" danger busy={busy} confirmDisabled={!closeReason.trim()} onCancel={() => setClosing(false)} onConfirm={() => void closePurchase()}><p>This permanently ends this purchase and releases its voucher reservation. No membership is activated. Payment corrections will no longer be available; a new purchase will use current pricing.</p><label>Reason (required)<textarea maxLength={500} value={closeReason} onChange={e => setCloseReason(e.target.value)} /></label>{message && <p role="status">{message}</p>}</SettingsConfirm>}
    </PaymentDrawer>}
  </main>;
}
