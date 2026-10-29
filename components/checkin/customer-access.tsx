"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { PurchaseForm } from "@/components/people/purchase-form";
import styles from "./customer-access.module.css";
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
  async function refreshMembership() {
    const sessionExpiry = summary?.expiresAt;
    const response = await fetch("/api/customer/session");
    if (!response.ok) throw new Error("Could not refresh membership details. Re-enter your phone number if your session expired.");
    const fresh: Summary = await response.json();
    setSummary(current => current?.expiresAt === sessionExpiry ? fresh : current);
  }
  return <main className={styles.portal}>
    <header className={styles.header}>
      <Link href="/checkin" className={styles.brand} aria-label="Tibay Gym check-in"><Image src="/tibay-gym-logo.svg" alt="" width={60} height={42} className={styles.brandMark} /><span>TIBAY <span className={styles.brandAccent}>GYM</span><small>Member portal</small></span></Link>
      {summary ? <button className={styles.textButton} disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out / use a different number"}</button> : <Link href="/checkin" className={styles.backLink}>← Back to check-in</Link>}
    </header>
    {!summary ? <div className={styles.welcome}>
      <div className={styles.intro}><span className={styles.eyebrow}>Your membership, at a glance</span><h1>More time training.<br /><span>Less time guessing.</span></h1><p>Check your membership, request a renewal, and follow your payment status in one place.</p><div className={styles.introNote}><span aria-hidden="true">01 — 02 — 03</span><p>Find your profile. Review your membership. Take your next step.</p></div></div>
      <section className={styles.loginPanel} aria-labelledby="access-title"><span className={styles.eyebrow}>Welcome to Tibay</span><h2 id="access-title">View my membership</h2><p>Enter the phone number saved with the gym to open your profile.</p>
        <form onSubmit={login} className={styles.loginForm}>
          <label htmlFor="customer-phone">Phone number</label><input id="customer-phone" required pattern="[0-9]{11}" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="09XX XXX XXXX" aria-describedby="phone-help" maxLength={11} value={phone} disabled={busy} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} />
          <small id="phone-help">Use your registered 11-digit mobile number.</small>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primaryButton} disabled={busy}>{busy ? "Opening your profile…" : "View my membership"}<span aria-hidden="true">→</span></button>
        </form><p className={styles.privacyNote}>This opens limited membership and payment details for a 30-minute session. The gym reviews all payment requests.</p>
      </section>
    </div> : <>
      <div className={styles.pageHeading}><div><span className={styles.eyebrow}>Member overview</span><h1>Your membership</h1><p>Your status, your payments, your next step.</p></div><span className={styles.sessionNote}>30-minute access session</span></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.membership} aria-labelledby="membership-title">
        <div className={styles.membershipMain}><h2 id="membership-title">Membership</h2><strong>{summary.type === "member" ? titleCase(summary.status ?? "Needs review") : "Guest profile"}</strong><p>{summary.type === "member" ? "Check your expiry before your next visit." : "Start a membership when you’re ready to train."}</p></div>
        <dl className={styles.membershipDetails}><div><dt>Rate category</dt><dd>{titleCase(summary.rateCategory ?? "Needs admin review")}</dd></div><div><dt>Membership expiry</dt><dd>{summary.membershipExpiryMs ? formatDate(summary.membershipExpiryMs) : "No active membership"}</dd></div><div><dt>Profile verification</dt><dd><span className={styles.badge} data-status={summary.verified ? "approved" : "pending"}>{summary.verified ? "Verified profile" : "Awaiting verification"}</span></dd></div></dl>
      </section>
      {(summary.type !== "member" || summary.status !== "active") && <div className={styles.notice}><div><strong>Training for the day?</strong><p>Choose a daily session at check-in and apply an eligible voucher before payment.</p></div><Link className={styles.secondaryButton} href="/checkin">Daily check-in →</Link></div>}
      {!summary.verified && <div className={styles.notice}><strong>Profile verification needed</strong><p>Ask the gym administrator to verify your profile before requesting a membership. You can still check your payments below.</p></div>}
      <CustomerPurchases allowPurchases={summary.verified} onRefreshMembership={refreshMembership} />
      <footer className={styles.footer}><Link href="/checkin">← Back to check-in</Link><p>Membership updates after the gym approves your payment.</p></footer>
    </>}
  </main>;
}
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/^./, char => char.toUpperCase());
const formatDate = (value: number) => new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
interface CustomerPayment { id: string; status: string; amountMinor: number; method: string; submittedAt: number; rejectionReason: string | null; closed?: boolean; voucherCode?: string; discountAmountMinor?: number; baseAmountMinor?: number }
function CustomerPurchases({ allowPurchases, onRefreshMembership }: { allowPurchases: boolean; onRefreshMembership(): Promise<void> }) {
  const [payments, setPayments] = useState<CustomerPayment[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  const [previous, setPrevious] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [browsingOlder, setBrowsingOlder] = useState(false);
  async function load(next?: string) {
    setRefreshing(true);
    try {
    const response = await fetch(`/api/customer/payments${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
    if (!response.ok) throw new Error("Your payment status is unavailable or the session expired. Re-enter your phone number to continue.");
    const result = await response.json(); setPayments(result.requests); setCursor(result.nextCursor); setError(""); setLoading(false); setUpdatedAt(Date.now()); setBrowsingOlder(Boolean(next));
    if (!next) await onRefreshMembership();
    } finally { setRefreshing(false); }
  }
  useEffect(() => { let active = true;
    fetch("/api/customer/payments").then(async response => { if (!response.ok) throw new Error("Could not load payment status. Re-enter your phone number if the session expired."); const result = await response.json(); if (active) { setPayments(result.requests); setCursor(result.nextCursor); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const latest = payments[0];
  function replace(id: string) {
    setPrevious(id);
    document.getElementById("customer-purchase")?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    document.getElementById("customer-purchase")?.focus({ preventScroll: true });
  }
  function paymentRow(payment: CustomerPayment) {
    return <article className={styles.paymentRow} key={payment.id}><div className={styles.paymentRowHeading}><strong>{money(payment.amountMinor)}</strong><span className={styles.badge} data-status={payment.status}>{payment.closed ? "closed" : payment.status}</span></div><p>{payment.method === "gcash" ? "GCash" : titleCase(payment.method)} <span aria-hidden="true">·</span> {formatDate(payment.submittedAt)} at {new Date(payment.submittedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</p>{payment.voucherCode && <p>Voucher {payment.voucherCode} · Saved {money(payment.discountAmountMinor ?? 0)}</p>}{payment.rejectionReason && <p className={styles.rejectionReason}>Reason: {payment.rejectionReason}</p>}{allowPurchases && !payment.closed && payment.status === "rejected" && <button className={styles.textButton} onClick={() => replace(payment.id)}>Correct submission →</button>}</article>;
  }
  return <>
    {!browsingOlder && !latest?.closed && latest?.status === "rejected" && <div className={styles.notice} data-tone="rejected"><div><strong>Your latest payment needs attention</strong><p>{latest.rejectionReason ? `Reason: ${latest.rejectionReason}` : "The gym rejected this submission. Review the details before sending a replacement."}</p></div>{allowPurchases && <button className={styles.secondaryButton} onClick={() => replace(latest.id)}>Correct submission →</button>}</div>}
    <div className={styles.contentGrid}>
      {allowPurchases && <div id="customer-purchase" className={styles.purchasePanel} tabIndex={-1}><PurchaseForm portal key={previous ?? "new"} previousRequestId={previous} onSubmitted={() => { setPrevious(undefined); void load().catch(e => setError(e.message)); }} />{previous && <button className={styles.textButton} onClick={() => setPrevious(undefined)}>Cancel replacement</button>}</div>}
      <section className={styles.paymentsPanel} aria-labelledby="payments-title"><div className={styles.sectionHeading}><h2 id="payments-title">Payment status</h2><button className={styles.textButton} disabled={refreshing || loading} onClick={() => load().catch(e => setError(e.message))}>{refreshing ? "Refreshing…" : "Refresh payment status"}</button></div>
        {updatedAt && <p className={styles.updated} role="status">Updated at {new Date(updatedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</p>}
        {loading && <div className={styles.skeleton} role="status">Loading payment status…</div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!loading && !error && !payments.length && <div className={styles.empty}><span aria-hidden="true">↗</span><h3>No payment requests yet</h3><p>Your submitted payments and their review status will appear here.</p></div>}
        {browsingOlder ? <><span className={styles.eyebrow}>Earlier requests</span>{payments.map(paymentRow)}<button className={styles.textButton} disabled={refreshing} onClick={() => load().catch(e => setError(e.message))}>Back to latest requests</button></> : latest && <><span className={styles.eyebrow}>Latest request</span>{paymentRow(latest)}{latest.status === "pending" && <p className={styles.pendingNote}>Awaiting gym approval. Your membership updates once payment is approved.</p>}{payments.length > 1 && <details className={styles.history}><summary>View payment history <span>{payments.length - 1} earlier on this page</span></summary>{payments.slice(1).map(paymentRow)}</details>}</>}
        {cursor && <button className={styles.secondaryButton} disabled={refreshing} onClick={() => load(cursor).catch(e => setError(e.message))}>Older requests</button>}
      </section>
    </div>
  </>;
}
