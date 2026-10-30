"use client";

import { PaymentMethodSelect } from "@/components/payments/payment-method-select";
import { PaymentAccountDetails } from "@/components/payments/payment-account-details";
import type { PaymentAccount } from "@/lib/finance/payment-methods";

import type { PaymentMethod } from "@/lib/finance/payment-methods";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { RECEIPT_RETENTION_NOTICE } from "@/lib/receipt-retention";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { PurchaseQuote } from "@/lib/server/purchases";
import styles from "./purchase-form.module.css";
import { VoucherEntry, PriceBreakdown, voucherError } from "./voucher-entry";
type Quote = PurchaseQuote & { paymentRevision?: number; paymentAccounts?: PaymentAccount[]; gcashAvailable?: boolean };
export function PurchaseForm({ admin = false, portal = false, personId, previousRequestId, onSubmitted }: { admin?: boolean; portal?: boolean; personId?: string; previousRequestId?: string; onSubmitted?: () => void }) {
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null), [method, setMethod] = useState<PaymentMethod>("cash");
  const [file, setFile] = useState<File | null>(null), [fileKey, setFileKey] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const receiptInput = useRef<HTMLInputElement>(null);
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
  if (portal) return <section className={styles.purchase} aria-labelledby="purchase-title">
    <div className={styles.heading}><h2 id="purchase-title">{previousRequestId ? "Correct your payment" : "Start or renew"}</h2><button type="button" disabled={busy || refreshing} onClick={() => refresh().catch(e => setMessage(e.message))}>{refreshing ? "Refreshing…" : "Refresh quote"}</button></div>
    <p className={styles.description}>{previousRequestId ? "Review this replacement before sending it for approval." : "Review your price and payment details before submitting."}</p>
    {!quote && !message && <LoadingSkeleton label="Loading your price and membership dates…" variant="form" />}
    {quote && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      {quote.coverage && !previousRequestId && <fieldset className={styles.duration} disabled={busy || refreshing}>
        <legend>Membership duration</legend>
        <div className={styles.durationOptions}>{[1, 2, 3, 4, 5, 12].map(months => <label key={months} className={styles.durationOption}>
          <input type="radio" name="membership-months" value={months} checked={quote.coverage?.months === months} onChange={() => void changeDuration(months)} />
          <span>{months === 12 ? "1 year" : `${months} ${months === 1 ? "month" : "months"}`}</span>
        </label>)}</div>
        <p className={styles.hint}>Priced at your monthly rate × the number of months.</p>
      </fieldset>}
      <div className={styles.quote} aria-live="polite" aria-busy={refreshing}><div><span>{quote.kind === "daily_session" ? "Daily session" : `${quote.coverage?.months ?? 1}-month membership`}</span><strong>{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(quote.amountMinor / 100)}</strong></div><span className={styles.category}>{quote.categorySnapshot.replace(/^./, char => char.toUpperCase())} · {quote.kind.replaceAll("_", " ")}</span>
      {quote.coverage && <dl className={styles.coverage}><div><dt>Estimated start</dt><dd>{coverageDate(quote.coverage.startDate)}</dd></div><span aria-hidden="true">→</span><div><dt>Estimated expiry</dt><dd>{coverageDate(quote.coverage.expiryDate)}</dd></div></dl>}</div>
      {quote.coverage && <p className={styles.hint}>Final dates are set at approval. Active memberships extend from their current expiry.</p>}
      {!previousRequestId && <VoucherEntry quote={quote} disabled={busy || refreshing} onApply={applyVoucher} />}
      {quote.voucherSnapshot && <PriceBreakdown quote={quote} />}
      <PaymentMethodSelect value={method} accounts={quote.paymentAccounts} available={quote.gcashAvailable} disabled={busy || refreshing} onChange={value => { setMethod(value); setFile(null); setFileKey(""); attempt.current = null; if (receiptInput.current) receiptInput.current.value = ""; }} />
      {method === "cash" && <p className={styles.hint}>Pay at the gym. Your request stays pending until staff confirm receipt.</p>}
      {method !== "cash" && <PaymentAccountDetails account={quote.paymentAccounts?.find(account => account.id === method)} />}
      {method !== "cash" && <div className={styles.receipt}><label htmlFor="customer-payment-receipt">{method === "gcash" ? "GCash receipt" : "Payment receipt"}</label><input id="customer-payment-receipt" ref={receiptInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} required onChange={e => { setFile(e.target.files?.[0] ?? null); setFileKey(crypto.randomUUID()); }} /><p className={styles.hint}>Upload a JPG, PNG or WebP up to 5 MB. Only submit proof for money already sent to the gym’s selected payment account.</p><p className={styles.hint}>{RECEIPT_RETENTION_NOTICE}</p></div>}
      <button className={styles.submit} disabled={busy || refreshing} type="submit">{busy ? "Submitting request…" : previousRequestId ? "Submit corrected payment" : "Submit payment request"}<span aria-hidden="true">→</span></button><p className={styles.approvalNote}>Reviewed by the gym before membership activation.</p>
    </form>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </section>;
  return <section className="rs-financial-ui" style={{ display: "grid", gap: 14, marginBlock: 20 }}><h2>{previousRequestId ? "Replace rejected payment" : "Membership purchase / renewal"}</h2>
    <p>One month at the configured monthly rate.</p>
    {!quote && !message && <LoadingSkeleton label="Loading configured price and coverage…" variant="form" />}
    {quote && <><p><strong>PHP {(quote.amountMinor / 100).toFixed(2)}</strong> · {quote.categorySnapshot} · {quote.kind.replaceAll("_", " ")}</p>
      {!previousRequestId && <VoucherEntry quote={quote} disabled={busy || refreshing} onApply={applyVoucher} />}
      {quote.voucherSnapshot && <PriceBreakdown quote={quote} />}
      {quote.coverage && <p>Preview: {quote.coverage.startDate} to {quote.coverage.expiryDate}. Final dates are calculated at approval; active memberships extend from the current expiry.</p>}
      <label>Payment method<select aria-label="Purchase payment method" value={method} disabled={busy} onChange={e => { setMethod(e.target.value as PaymentMethod); setFile(null); setFileKey(""); attempt.current = null; if (receiptInput.current) receiptInput.current.value = ""; }} style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }}>
        <option value="cash">Cash — pending confirmation</option>{!admin && <>{quote.paymentAccounts ? quote.paymentAccounts.map(account => <option key={account.id} value={account.id} disabled={!quote.gcashAvailable}>{account.name}{!quote.gcashAvailable ? " — receipt upload unavailable" : ""}</option>) : <option value="gcash" disabled={!quote.gcashAvailable}>GCash{!quote.gcashAvailable ? " — currently unavailable" : ""}</option>}</>}
      </select></label>
      {method !== "cash" && <PaymentAccountDetails account={quote.paymentAccounts?.find(account => account.id === method)} />}
      {method !== "cash" && <label>{method === "gcash" ? "GCash receipt" : "Payment receipt"}<input aria-label="Purchase receipt" ref={receiptInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setFileKey(crypto.randomUUID()); }} /><p>Submit evidence only for money already sent to the gym&apos;s selected payment account.</p><p>{RECEIPT_RETENTION_NOTICE}</p></label>}
      <button disabled={busy || refreshing} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit payment request for review"}</button>
    </>}
    <button type="button" disabled={busy} onClick={() => refresh().catch(e => setMessage(e.message))}>Refresh purchase quote</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
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
