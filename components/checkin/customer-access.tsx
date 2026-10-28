"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { PurchaseForm } from "@/components/people/purchase-form";
interface Summary { rateCategory: string | null; type: string; status: string | null; membershipExpiryMs: number | null; verified: boolean; expiresAt: number }
export function CustomerAccess() {
  const [phone, setPhone] = useState(""), [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!summary) return;
    const timer = window.setTimeout(() => { setSummary(null); setPhone(""); setError("Your session expired. Re-enter your phone number to continue."); }, Math.max(0, summary.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [summary]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Please wait before trying again." : "Could not access this account. Check the number or ask the gym administrator.");
      const details = await fetch("/api/customer/session");
      if (!details.ok) throw new Error("Your session could not be confirmed. Try again.");
      setSummary(await details.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not access your account."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer/session", { method: "DELETE", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("Could not close your session. Please retry.");
      setSummary(null); setPhone("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not close your session. Please retry."); }
    finally { setBusy(false); }
  }
  return <main className="rs-financial-ui" style={{ maxWidth: 620, margin: "auto", padding: 24, minHeight: "100svh" }}>
    <h1>Renewal and payment status</h1><p>Enter your saved phone number to access limited membership and payment information. Payment approval stays with the gym administrator.</p>
    {!summary ? <form onSubmit={login} style={{ display: "grid", gap: 14 }}>
      <label>Phone number<input aria-label="Phone number" required pattern="[0-9]{11}" type="tel" inputMode="numeric" maxLength={11} value={phone} disabled={busy} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} style={{ width: "100%", minHeight: 46, fontSize: 16 }} /></label>
      <button disabled={busy}>{busy ? "Opening…" : "Continue"}</button>
    </form> : <section><h2>Membership</h2><p>{summary.verified ? "Verified profile" : "Awaiting profile verification"} · {summary.rateCategory ?? "Category needs admin review"}</p>
      <p>{summary.type === "member" ? `Membership ${summary.status ?? "needs review"}` : "Guest profile"}</p>
      {summary.membershipExpiryMs && <p>Expiry: {new Date(summary.membershipExpiryMs).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</p>}
      <p>Your restricted session lasts 30 minutes.</p>
      {!summary.verified && <p>Ask the gym administrator to verify your profile before requesting membership.</p>}
      <CustomerPurchases allowPurchases={summary.verified} />
      <button disabled={busy} onClick={() => void logout()}>{busy ? "Closing session…" : "Sign out / use a different number"}</button>
    </section>}
    {error && <p role="alert">{error}</p>}<p><Link href="/checkin">Back to check-in</Link></p>
  </main>;
}
interface CustomerPayment { id: string; status: string; amountMinor: number; method: string; submittedAt: number; rejectionReason: string | null }
function CustomerPurchases({ allowPurchases }: { allowPurchases: boolean }) {
  const [payments, setPayments] = useState<CustomerPayment[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  const [previous, setPrevious] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  async function load(next?: string) {
    const response = await fetch(`/api/customer/payments${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
    if (!response.ok) throw new Error("Your payment status is unavailable or the session expired. Re-enter your phone number to continue.");
    const result = await response.json(); setPayments(result.requests); setCursor(result.nextCursor); setError(""); setLoading(false);
  }
  useEffect(() => { let active = true;
    fetch("/api/customer/payments").then(async response => { if (!response.ok) throw new Error("Could not load payment status. Re-enter your phone number if the session expired."); const result = await response.json(); if (active) { setPayments(result.requests); setCursor(result.nextCursor); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <section>
    {allowPurchases && <PurchaseForm key={previous ?? "new"} previousRequestId={previous} onSubmitted={() => { setPrevious(undefined); void load().catch(e => setError(e.message)); }} />}
    {previous && <button onClick={() => setPrevious(undefined)}>Cancel replacement / new purchase quote</button>}
    <h2>Payment status</h2><button onClick={() => load().catch(e => setError(e.message))}>Refresh payment status</button>
    {loading && <p role="status">Loading payment status…</p>}
    {!loading && !error && !payments.length && <p>No payment requests on this page.</p>}
    {payments.map(payment => <article key={payment.id} style={{ marginBlock: 16, paddingBlock: 12, borderBottom: "1px solid var(--rs-line)" }}>
      <p>PHP {(payment.amountMinor / 100).toFixed(2)} · {payment.method} · <strong>{payment.status}</strong></p>
      <p>{new Date(payment.submittedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
      {payment.rejectionReason && <p>Reason: {payment.rejectionReason}</p>}
      {allowPurchases && payment.status === "rejected" && <button onClick={() => setPrevious(payment.id)}>Replace rejected submission</button>}
    </article>)}
    {cursor && <button onClick={() => load(cursor).catch(e => setError(e.message))}>Older requests</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
