"use client";
import { availablePaymentAccounts } from "@/lib/finance/payment-methods";
import { FormSelect } from "@/components/ui/form-select";
import { StyledSelect } from "@/components/ui/styled-select";

import { PaymentMethodSelect } from "@/components/payments/payment-method-select";
import { PaymentAccountDetails } from "@/components/payments/payment-account-details";
import type { PaymentAccount } from "@/lib/finance/payment-methods";

import type { PaymentMethod } from "@/lib/finance/payment-methods";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { RECEIPT_RETENTION_NOTICE } from "@/lib/receipt-retention";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { PurchaseQuote } from "@/lib/server/purchases";
import styles from "./purchase-form.module.css";
import { VoucherEntry, PriceBreakdown, voucherError } from "./voucher-entry";
type Quote = PurchaseQuote & { paymentRevision?: number; paymentAccounts?: PaymentAccount[]; gcashAvailable?: boolean };
const durations = [1, 2, 3, 4, 5, 12];
const durationLabel = (months: number) => months === 12 ? "1 year" : `${months} ${months === 1 ? "month" : "months"}`;
export function PurchaseForm({ admin = false, portal = false, heading, loadingFallback, personId, previousRequestId, onSubmitted }: { admin?: boolean; portal?: boolean; heading?: string; loadingFallback?: ReactNode; personId?: string; previousRequestId?: string; onSubmitted?: () => void }) {
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null), [method, setMethod] = useState<PaymentMethod>("cash");
  const [file, setFile] = useState<File | null>(null), [fileKey, setFileKey] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const durationIndex = durations.indexOf(quote?.coverage?.months ?? 1);
  const receiptInput = useRef<HTMLInputElement>(null);
  const messageTarget = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (portal && message) {
      messageTarget.current?.scrollIntoView?.({ block: "center", behavior: "instant" });
      messageTarget.current?.focus({ preventScroll: true });
    }
  }, [message, portal]);
  const attempt = useRef<{ key: string; id: string; proof?: { receiptId: string; receiptToken: string } } | null>(null);
  const endpoint = admin ? `/api/finance/purchases?personId=${encodeURIComponent(personId ?? "")}` : `/api/customer/purchase${previousRequestId ? `?previousRequestId=${encodeURIComponent(previousRequestId)}` : ""}`;
  function quoteEndpoint(code?: string, months = quote?.coverage?.months ?? 1) {
    const params = new URLSearchParams();
    if (code) params.set("voucherCode", code);
    if (portal && !previousRequestId) params.set("months", String(months));
    return `${endpoint}${params.size ? `${endpoint.includes("?") ? "&" : "?"}${params}` : ""}`;
  }
  async function changeDuration(months: number) {
    if (busy || refreshing || months === quote?.coverage?.months) return;
    setRefreshing(true); setMessage("");
    try {
      const response = await fetch(quoteEndpoint(quote?.voucherSnapshot?.code, months), { headers: await headers() });
      const result: Quote & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error?.startsWith("voucher-") ? voucherError(result.error) : "Could not update the duration. Try again.");
      setQuote(result); attempt.current = null; setFile(null); setFileKey(""); if (receiptInput.current) receiptInput.current.value = "";
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not update the duration. Try again."); }
    finally { setRefreshing(false); }
  }
  async function headers(): Promise<Record<string, string>> { return admin ? { Authorization: `Bearer ${await user?.getIdToken()}` } : {}; }
  async function refresh() {
    setRefreshing(true);
    try {
    const code = !previousRequestId ? quote?.voucherSnapshot?.code : undefined;
    const response = await fetch(quoteEndpoint(code), { headers: await headers() });
    if (!response.ok) { setQuote(null); throw new Error("A purchase quote is unavailable. Ask the admin to verify the profile, rate category, and monthly price, then refresh."); }
    const refreshed: Quote = await response.json();
    if (refreshed.quoteToken !== quote?.quoteToken) { attempt.current = null; setFile(null); setFileKey(""); if (receiptInput.current) receiptInput.current.value = ""; }
    setQuote(refreshed);
    setMessage("");
    } finally { setRefreshing(false); }
  }
  useEffect(() => {
    let active = true;
    const token = admin ? user?.getIdToken() : Promise.resolve(null);
    if (!token) return;
    token.then(value => fetch(endpoint, { headers: value ? { Authorization: `Bearer ${value}` } : {} }))
      .then(async response => { if (!response.ok) throw new Error("A purchase quote is unavailable. Ask the admin to verify the profile, category, and monthly price."); const data = await response.json(); if (active) setQuote(data); })
      .catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [user, admin, endpoint]);
  async function applyVoucher(code: string) {
    setRefreshing(true);
    try {
      const response = await fetch(quoteEndpoint(code), { headers: await headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(voucherError(result.error));
      setQuote(result); attempt.current = null; setFile(null); setFileKey(""); if (receiptInput.current) receiptInput.current.value = ""; setMessage("");
    } finally { setRefreshing(false); }
  }
  async function submit() {
    if (!quote || busy || refreshing) return;
    setBusy(true); setMessage("");
    try {
      if (method !== "cash" && quote.paymentAccounts && !quote.paymentAccounts.some(account => account.id === method)) throw new Error("This payment account is no longer available. Select another method.");
      const body = { method, ...(quote.coverage ? { months: quote.coverage.months } : {}), ...(method !== "cash" ? { paymentRevision: quote.paymentRevision } : {}), quoteToken: quote.quoteToken, ...(!previousRequestId && quote.voucherSnapshot ? { voucherCode: quote.voucherSnapshot.code } : {}), ...(personId && admin ? { personId } : {}), ...(previousRequestId ? { previousRequestId } : {}) };
      const key = JSON.stringify([body, fileKey]);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const current = attempt.current;
      if (method !== "cash" && !current.proof) {
        if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP receipt up to 5 MB.");
        const uploaded = await fetch("/api/receipts/upload", { method: "POST", headers: { "Content-Type": file.type, "x-payment-revision": String(quote.paymentRevision ?? 0), "x-payment-method": method, "x-operation-id": current.id,
          "x-expected-amount": String(quote.amountMinor), "x-charge-kind": quote.kind, ...(quote.coverage ? { "x-membership-months": String(quote.coverage.months) } : {}), ...(!previousRequestId && quote.voucherSnapshot ? { "x-voucher-code": quote.voucherSnapshot.code } : {}), ...(previousRequestId ? { "x-previous-request-id": previousRequestId } : {}) }, body: file });
        if (!uploaded.ok) throw new Error("Receipt upload did not complete. Retry the same image or choose cash. No membership was activated.");
        current.proof = await uploaded.json();
      }
      const response = await fetch(admin ? "/api/finance/purchases" : "/api/customer/purchase", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() },
        body: JSON.stringify({ ...body, operationId: current.id, ...(current.proof ?? {}) }) });
      if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error?.startsWith("voucher-") ? voucherError(failure.error) : "Could not confirm this request. Check payment status, refresh the quote, and retry. An existing pending request must be reviewed first."); }
      attempt.current = null; setQuote(null); setMessage("Payment request submitted for admin review. Membership is unchanged until approval."); onSubmitted?.();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not submit the request. Retry to recover it safely."); }
    finally { setBusy(false); }
  }
  if (!quote && !message && loadingFallback) return <>{loadingFallback}</>;
  if (portal) return <section className={styles.purchase} aria-labelledby="purchase-title">
    <div className={styles.heading}><h2 id="purchase-title" className={styles.srOnly}>{heading ?? (previousRequestId ? "Correct your payment" : "Start or renew")}</h2><button type="button" disabled={busy || refreshing} onClick={() => refresh().catch(e => setMessage(e.message))}><span aria-hidden="true">↻ </span>{refreshing ? "Refreshing…" : "Refresh quote"}</button></div>
    {!quote && !message && <LoadingSkeleton label="Loading your price and membership dates…" variant="form" />}
    {quote && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {quote.coverage && !previousRequestId && <fieldset className={styles.duration} disabled={busy || refreshing}>
        <legend><span className={styles.stepNumber} aria-hidden="true">1.</span> Choose duration</legend>
        <div className={styles.durationStepper}>
          <button type="button" className={styles.stepButton} aria-label="Shorter membership duration" disabled={busy || refreshing || durationIndex <= 0} onClick={() => void changeDuration(durations[durationIndex - 1])}><span aria-hidden="true">−</span></button>
          <div className={styles.durationPicker}><StyledSelect label="Membership duration" value={String(quote.coverage.months)} options={durations.map(months => ({ value: String(months), name: durationLabel(months) }))} disabled={busy || refreshing} onChange={value => void changeDuration(Number(value))} /></div>
          <button type="button" className={styles.stepButton} aria-label="Longer membership duration" disabled={busy || refreshing || durationIndex < 0 || durationIndex >= durations.length - 1} onClick={() => void changeDuration(durations[durationIndex + 1])}><span aria-hidden="true">+</span></button>
        </div>
        <p className={styles.durationHelp}>Tap the duration to choose from all options.</p>
      </fieldset>}
      <h3 className={styles.stepHeading}><span className={styles.stepNumber} aria-hidden="true">{previousRequestId || !quote.coverage ? "1." : "2."}</span> Payment details</h3>
      <div className={styles.quote} aria-live="polite" aria-busy={refreshing}><div><span>Amount</span><strong>{portalMoney(quote.amountMinor)}</strong></div><span className={styles.category}>{quote.categorySnapshot.replace(/^./, char => char.toUpperCase())} · {quote.kind === "daily_session" ? "Daily session" : `${quote.coverage?.months ?? 1}-month membership`}</span>
      {quote.coverage && <dl className={styles.coverage}><div><dt>Estimated start</dt><dd>{coverageDate(quote.coverage.startDate)}</dd></div><span aria-hidden="true">→</span><div><dt>Estimated expiry</dt><dd>{coverageDate(quote.coverage.expiryDate)}</dd></div></dl>}</div>
      {quote.coverage && <p className={styles.hint}>Final dates are set at approval. Active memberships extend from their current expiry.</p>}
      {!previousRequestId && <div className={styles.voucher}><VoucherEntry quote={quote} disabled={busy || refreshing} onApply={applyVoucher} /></div>}
      {quote.voucherSnapshot && <PriceBreakdown quote={quote} />}
      <h3 className={styles.stepHeading}><span className={styles.stepNumber} aria-hidden="true">{previousRequestId || !quote.coverage ? "2." : "3."}</span> Payment method</h3>
      <div className={styles.paymentChoice}><PaymentMethodSelect placement="top" value={method} accounts={quote.paymentAccounts} available={quote.gcashAvailable} disabled={busy || refreshing} onChange={value => { setMethod(value); setFile(null); setFileKey(""); attempt.current = null; if (receiptInput.current) receiptInput.current.value = ""; }} /></div>
      {method === "cash" && <p className={styles.hint}>Pay at the gym. Your request stays pending until staff confirm receipt.</p>}
      {method !== "cash" && <PaymentAccountDetails account={quote.paymentAccounts?.find(account => account.id === method)} />}
      {method !== "cash" && <div className={styles.receipt}><label htmlFor="customer-payment-receipt">{method === "gcash" ? "GCash receipt" : "Payment receipt"}</label><input id="customer-payment-receipt" ref={receiptInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} required onChange={e => { setFile(e.target.files?.[0] ?? null); setFileKey(crypto.randomUUID()); }} /><p className={styles.hint}>Upload a JPG, PNG or WebP up to 5 MB. Only submit proof for money already sent to the gym’s selected payment account.</p><p className={styles.hint}>{RECEIPT_RETENTION_NOTICE}</p></div>}
      <div className={styles.submitDock}>
        <button className={styles.submit} disabled={busy || refreshing} type="submit"><span>{busy ? "Submitting request…" : previousRequestId ? "Submit corrected payment" : "Submit payment request"}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></button>
        <p className={styles.approvalNote}>Reviewed by the gym before membership activation.</p>
      </div>
    </form>}
    {message && <p ref={messageTarget} tabIndex={-1} className={styles.message} role="status">{message}</p>}
  </section>;
  return <section className="rs-financial-ui" style={{ display: "grid", gap: 14, marginBlock: 20 }}><h2>{previousRequestId ? "Replace rejected payment" : "Membership purchase / renewal"}</h2>
    <p>One month at the configured monthly rate.</p>
    {!quote && !message && <LoadingSkeleton label="Loading configured price and coverage…" variant="form" />}
    {quote && <><p><strong>PHP {(quote.amountMinor / 100).toFixed(2)}</strong> · {quote.categorySnapshot} · {quote.kind.replaceAll("_", " ")}</p>
      {!previousRequestId && <VoucherEntry quote={quote} disabled={busy || refreshing} onApply={applyVoucher} />}
      {quote.voucherSnapshot && <PriceBreakdown quote={quote} />}
      {quote.coverage && <p>Preview: {quote.coverage.startDate} to {quote.coverage.expiryDate}. Final dates are calculated at approval; active memberships extend from the current expiry.</p>}
      <label>Payment method<FormSelect aria-label="Purchase payment method" value={method} disabled={busy} onChange={e => { setMethod(e.target.value as PaymentMethod); setFile(null); setFileKey(""); attempt.current = null; if (receiptInput.current) receiptInput.current.value = ""; }} style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }}>
        <option value="cash">Cash — pending confirmation</option>{!admin && <>{quote.paymentAccounts ? availablePaymentAccounts(quote.paymentAccounts).map(account => <option key={account.id} value={account.id} disabled={!quote.gcashAvailable}>{account.name}{!quote.gcashAvailable ? " — receipt upload unavailable" : ""}</option>) : <option value="gcash" disabled={!quote.gcashAvailable}>GCash{!quote.gcashAvailable ? " — currently unavailable" : ""}</option>}</>}
      </FormSelect></label>
      {method !== "cash" && <PaymentAccountDetails account={quote.paymentAccounts?.find(account => account.id === method)} />}
      {method !== "cash" && <label>{method === "gcash" ? "GCash receipt" : "Payment receipt"}<input aria-label="Purchase receipt" ref={receiptInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setFileKey(crypto.randomUUID()); }} /><p>Submit evidence only for money already sent to the gym&apos;s selected payment account.</p><p>{RECEIPT_RETENTION_NOTICE}</p></label>}
      <button disabled={busy || refreshing} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit payment request for review"}</button>
    </>}
    <button type="button" disabled={busy} onClick={() => refresh().catch(e => setMessage(e.message))}>Refresh purchase quote</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
const portalMoney = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100);
function coverageDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
}
export function NewProfilePurchaseQuote({ category, onQuote, disabled }: { category: string; onQuote(quote: PurchaseQuote | null): void; disabled?: boolean }) {
  const { user } = useAuth(); const [message, setMessage] = useState("Choose a category to review monthly pricing.");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (user && category) user.getIdToken().then(token => fetch(`/api/finance/purchases?category=${encodeURIComponent(category)}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Configure the applicable monthly rate in Settings before creating a membership request."); const quote: PurchaseQuote = await response.json();
        if (active) { setQuote(quote); onQuote(quote); setMessage(`One month: PHP ${(quote.amountMinor / 100).toFixed(2)}. Coverage preview ${quote.coverage?.startDate} to ${quote.coverage?.expiryDate}. The profile remains a guest until payment approval.`); } })
      .catch(e => { if (active) { onQuote(null); setMessage(e.message); } });
    return () => { active = false; };
  }, [user, category, onQuote]);
  async function applyVoucher(code: string) {
    if (disabled) return;
    setBusy(true); onQuote(null);
    try {
      const response = await fetch(`/api/finance/purchases?category=${encodeURIComponent(category)}${code ? `&voucherCode=${encodeURIComponent(code)}` : ""}`, { headers: { Authorization: `Bearer ${await user?.getIdToken()}` } });
      const result = await response.json(); if (!response.ok) throw new Error(voucherError(result.error));
      setQuote(result); onQuote(result); setMessage("Review the total below. Membership activates only after payment approval.");
    } catch (e) { onQuote(quote); throw e; }
    finally { setBusy(false); }
  }
  return <section><h2>New membership request</h2><p role="status">{message}</p>{quote && <><VoucherEntry quote={quote} disabled={busy || disabled} onApply={applyVoucher} />{quote.voucherSnapshot && <PriceBreakdown quote={quote} />}</>}<p>Saving creates the profile and a pending cash request. Confirm actual receipt of funds in Payment review to activate membership.</p></section>;
}
