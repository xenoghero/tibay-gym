"use client";

import { paymentLabel } from "@/lib/finance/payment-methods";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { BrandLoading } from "@/components/ui/brand-loading";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { PurchaseForm } from "@/components/people/purchase-form";
import { PromotionBanner } from "./promotion-banner";
import styles from "./customer-access.module.css";
interface Summary { name: string; rateCategory: string | null; type: string; status: string | null; membershipExpiryMs: number | null; verified: boolean; expiresAt: number }
export function CustomerAccess({ membershipSetup = false }: { membershipSetup?: boolean } = {}) {
  const [phone, setPhone] = useState(""), [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(membershipSetup);
  useEffect(() => {
    if (!summary) return;
    const timer = window.setTimeout(() => { setSummary(null); setPhone(""); setError("Your session expired. Re-enter your phone number to continue."); }, Math.max(0, summary.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [summary]);
  const openAccount = useCallback(async (number: string, membership: boolean) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: number }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(response.status === 429 ? "Too many attempts. Please wait before trying again." : "Could not access this account. Check the number or ask the gym administrator.");
      const details = await fetch("/api/customer/session", { signal: AbortSignal.timeout(20_000) });
      if (!details.ok) throw new Error("Your session could not be confirmed. Try again.");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${membership ? "#renew" : "#overview"}`);
      setSummary(await details.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not access your account."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (!membershipSetup) return;
    const controller = new AbortController();
    fetch("/api/customer/session", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
      .then(async response => {
        if (response.status === 401) return;
        if (!response.ok) throw new Error("Could not confirm your session. Re-enter your phone number to continue.");
        const details: Summary = await response.json();
        if (controller.signal.aborted) return;
        if (!window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#renew`);
        setSummary(details);
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not confirm your session. Please retry."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [membershipSetup]);
  function login(event: FormEvent) {
    event.preventDefault(); void openAccount(phone, membershipSetup);
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
  if (membershipSetup && busy && !summary) return <BrandLoading fullscreen />;

  return <main className={`${styles.portal} ${styles.memberPortal} ${!summary ? styles.entryPortal : ""} ${membershipSetup ? styles.checkinPortal : ""}`}>
    <header className={styles.header}>
      <Link href={summary ? "#overview" : "/checkin"} className={styles.brand} aria-label={summary ? "Tibay Gym member overview" : "Tibay Gym check-in"}><Image src="/tibay-gym-mark-transparent.svg" alt="" width={60} height={42} className={styles.brandMark} /><span>TIBAY <span className={styles.brandAccent}>GYM</span><small>Member portal</small></span></Link>
      {summary ? <div className={styles.headerActions}><Link href="/checkin" className={styles.backLink}>Check-in ↗</Link><button className={styles.textButton} aria-label="Sign out / use a different number" disabled={busy} onClick={() => void logout()}>{busy ? "Signing out…" : "Sign out ↗"}</button></div> : <Link href="/checkin" className={styles.backLink} aria-label="Back to check-in">Check-in ↗</Link>}
    </header>
    {!summary ? <div className={styles.welcome}>
      <section className={styles.loginPanel} aria-labelledby="access-title">
        <span className={styles.accessWatermark} aria-hidden="true">TG</span>
        <div className={styles.accessHeading}><span className={styles.eyebrow}>Welcome to Tibay</span><h1 id="access-title">View my <span>membership</span></h1><p>Check your status, start or renew a membership, and track your payments.</p></div>
        <form onSubmit={login} className={styles.loginForm}>
          <label htmlFor="customer-phone">Phone number</label><input id="customer-phone" required pattern="[0-9]{11}" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="09XX XXX XXXX" aria-describedby="phone-help" maxLength={11} value={phone} disabled={busy} onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} />
          <small id="phone-help">Use your registered 11-digit mobile number.</small>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primaryButton} disabled={busy}>{busy ? "Opening your profile…" : "View my membership"}<span aria-hidden="true">→</span></button>
        </form><p className={styles.privacyNote}>Limited profile access for 30 minutes. Membership changes take effect after gym approval.</p>
      </section>
      {!membershipSetup && <PromotionBanner />}
    </div> : <div className={styles.memberWorkspace}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <CustomerPurchases summary={summary} onRefreshMembership={refreshMembership} checkin={membershipSetup} />
      <footer className={styles.sessionFooter}>30-minute access session</footer>
    </div>}
  </main>;
}
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/^./, char => char.toUpperCase());
const formatDate = (value: number) => new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: value % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(value / 100);
interface CustomerPayment { id: string; status: string; amountMinor: number; method: string; kind?: import("@/lib/finance/contracts").ChargeKind | null; paymentAccountSnapshot?: import("@/lib/finance/payment-methods").PaymentAccountSnapshot; submittedAt: number; rejectionReason: string | null; closed?: boolean; voucherCode?: string; discountAmountMinor?: number; baseAmountMinor?: number }
type PortalScreen = "overview" | "renew" | "history";
const portalDestinations: { screen: PortalScreen; label: string; icon: string }[] = [
  { screen: "overview", label: "Overview", icon: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" },
  { screen: "renew", label: "Membership", icon: "M3 5h18v14H3ZM3 9h18M7 14h4m4 0h2" },
  { screen: "history", label: "Payments", icon: "M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 7h6M9 11h6M9 15h3" },
];
function screenFromHash(): PortalScreen {
  return window.location.hash === "#renew" ? "renew" : window.location.hash === "#history" ? "history" : "overview";
}
function CustomerPurchases({ summary, onRefreshMembership, checkin = false }: { summary: Summary; onRefreshMembership(): Promise<void>; checkin?: boolean }) {
  const [screen, setScreen] = useState<PortalScreen>(checkin ? "renew" : "overview");
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [pendingMembership, setPendingMembership] = useState<CustomerPayment | null>(null);
  const [history, setHistory] = useState<CustomerPayment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [previous, setPrevious] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [browsingOlder, setBrowsingOlder] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const returnScreen = useRef<PortalScreen>("overview");
  const allowPurchases = summary.verified;
  const isMember = summary.type === "member";
  const membershipStatus = isMember ? titleCase(summary.status ?? "Needs review") : "Guest";
  const membershipAction = isMember ? "Renew membership" : "Start membership";
  const latest = payments[0];
  const needsAttention = !latest?.closed && latest?.status === "rejected";

  useEffect(() => {
    const syncScreen = () => {
      const next = screenFromHash();
      setScreen(next);
      if (next !== "renew") setPrevious(undefined);
    };
    syncScreen();
    window.addEventListener("hashchange", syncScreen);
    window.addEventListener("popstate", syncScreen);
    return () => {
      window.removeEventListener("hashchange", syncScreen);
      window.removeEventListener("popstate", syncScreen);
    };
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0, behavior: "instant" });
  }, [screen]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetch("/api/customer/payments", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not load payment status. Re-enter your phone number if the session expired.");
      const result = await response.json();
      if (!controller.signal.aborted && requestVersion.current === 0) { setPayments(result.requests); setHistory(result.requests); setCursor(result.nextCursor); setPendingMembership(result.pendingMembership ?? null); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  function navigate(next: PortalScreen) {
    window.history.pushState(null, "", next === "overview" ? "#overview" : `#${next}`);
    setScreen(next);
    if (next !== "renew") setPrevious(undefined);
    window.scrollTo?.({ top: 0, behavior: "instant" });
  }
  async function load(next?: string) {
    const version = ++requestVersion.current;
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch(`/api/customer/payments${next ? `?cursor=${encodeURIComponent(next)}` : ""}`);
      if (!response.ok) throw new Error("Your payment status is unavailable or the session expired. Re-enter your phone number to continue.");
      const result = await response.json();
      if (!mounted.current || version !== requestVersion.current) return;
      setHistory(result.requests); setCursor(result.nextCursor); setBrowsingOlder(Boolean(next));
      setLoading(false);
      if (!next) { setPayments(result.requests); setPendingMembership(result.pendingMembership ?? null); setUpdatedAt(Date.now()); await onRefreshMembership(); }
    } catch (reason) {
      if (mounted.current && version === requestVersion.current) setError(reason instanceof Error ? reason.message : "Could not load payment status.");
    } finally {
      if (mounted.current && version === requestVersion.current) setRefreshing(false);
    }
  }
  function replace(id: string) {
    returnScreen.current = screen;
    setPrevious(id);
    setConfirmation("");
    navigate("renew");
  }
  function paymentRow(payment: CustomerPayment, showCorrection = true) {
    const badge = <span className={styles.badge} data-status={payment.closed ? "closed" : payment.status}><span aria-hidden="true">{payment.closed ? "−" : payment.status === "approved" ? "✓" : payment.status === "rejected" ? "×" : "◷"}</span>{payment.closed ? "Closed" : payment.status === "pending" ? "Pending review" : titleCase(payment.status)}</span>;
    if (screen === "history") return <article className={styles.historyCard} data-status={payment.status} key={payment.id}>
      <div className={styles.historyDate}><time dateTime={new Date(payment.submittedAt).toISOString()}>{formatDate(payment.submittedAt)}</time><span>{paymentLabel(payment)}</span></div>
      <strong className={styles.historyAmount}>{money(payment.amountMinor)}</strong>
      <div className={styles.historyState}>{badge}{payment.rejectionReason && <p>{payment.rejectionReason}</p>}{!payment.closed && payment.status === "pending" && <p>Awaiting gym approval.</p>}</div>
      {payment.voucherCode && <p className={styles.historyVoucher}>Voucher {payment.voucherCode} · Saved {money(payment.discountAmountMinor ?? 0)}</p>}
      {showCorrection && allowPurchases && !payment.closed && payment.status === "rejected" && <button className={styles.historyCorrection} onClick={() => replace(payment.id)}>Correct submission →</button>}
    </article>;
    return <article className={styles.paymentRow} key={payment.id}>
      <div className={styles.paymentRowHeading}><strong>{money(payment.amountMinor)}</strong>{badge}</div>
      <p>{paymentLabel(payment)} <span aria-hidden="true">·</span> {formatDate(payment.submittedAt)} at {new Date(payment.submittedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</p>
      {payment.voucherCode && <p>Voucher {payment.voucherCode} · Saved {money(payment.discountAmountMinor ?? 0)}</p>}
      {payment.rejectionReason && <p className={styles.rejectionReason}>Reason: {payment.rejectionReason}</p>}
      {showCorrection && allowPurchases && !payment.closed && payment.status === "rejected" && <button className={styles.textButton} onClick={() => replace(payment.id)}>Correct submission →</button>}
    </article>;
  }
  const title = screen === "history" ? "Payment history" : screen === "renew" ? previous ? "Correct your payment" : membershipAction : "Your membership";
  if (checkin && loading) return <BrandLoading fullscreen />;

  return <>
    <nav className={styles.portalNav} aria-label="Member navigation">
      {portalDestinations.map(destination => <a key={destination.screen} href={`#${destination.screen}`} aria-current={screen === destination.screen ? "page" : undefined} onClick={event => {
        event.preventDefault();
        if (screen === destination.screen) return;
        if (destination.screen === "renew") setPrevious(undefined);
        navigate(destination.screen);
      }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={destination.icon} /></svg><span>{destination.label}</span></a>)}
    </nav>
    <div className={styles.portalHeading}>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
    </div>
    {confirmation && <p className={styles.confirmation} role="status">{confirmation}</p>}
    {checkin && screen === "overview" && pendingMembership && <p className={styles.pendingNote}>Membership-covered check-in is available after admin payment approval. Please approach the front desk. No daily charge or attendance was created by this membership request.</p>}
    {screen === "overview" && <>
      <section className={styles.memberPass} aria-label="Membership card" data-status={isMember ? summary.status ?? "review" : "guest"}>
        <span className={styles.passWatermark} aria-hidden="true">TG</span>
        <div className={styles.passBrand}>TIBAY <span>GYM</span><small>Membership</small></div>
        <h2 className={styles.passStatus}>{membershipStatus}</h2>
        <p className={styles.passName}>{summary.name}</p>
        <div className={styles.passMeta}><span>{titleCase(summary.rateCategory ?? "Rate needs review")}</span><span>{summary.verified ? "✓ Verified profile" : "Awaiting verification"}</span></div>
        <div className={styles.passExpiry}><span>{isMember && summary.membershipExpiryMs ? summary.status === "expired" ? "Expired on" : "Valid until" : "Membership"}</span><strong>{isMember && summary.membershipExpiryMs ? formatDate(summary.membershipExpiryMs) : "No active membership"}</strong></div>
      </section>
      {allowPurchases && <a href="#renew" className={`${styles.primaryButton} ${styles.membershipCta}`} onClick={event => { event.preventDefault(); setPrevious(undefined); setConfirmation(""); navigate("renew"); }}><span aria-hidden="true">↻</span>{membershipAction}<span aria-hidden="true">›</span></a>}
      {(!isMember || summary.status !== "active") && <Link className={styles.actionLink} href="/checkin"><span>Daily check-in<small>Training for the day? Choose a daily session at check-in.</small></span><span aria-hidden="true">→</span></Link>}
    </>}
    {screen !== "history" && !allowPurchases && <div className={styles.notice}><div><strong>Profile verification needed</strong><p>Please ask the front desk to verify your account to start membership. You can still view your payment status and history.</p>
      {checkin && <Link href="/checkin" className={styles.backLink}>Choose a daily session →</Link>}</div></div>}
    {screen === "renew" && allowPurchases && <>
      {checkin && !previous && loading ? <LoadingSkeleton label="Checking existing membership requests…" /> : checkin && !previous && error ?
        <button className={styles.secondaryButton} disabled={refreshing} onClick={() => void load()}>Retry payment status</button> : checkin && !previous && pendingMembership ?
        <section className={styles.paymentPanel} aria-label="Pending membership request"><h2>Membership pending approval</h2>
          {paymentRow(pendingMembership, false)}
          <p className={styles.pendingNote}>Please approach the front desk to confirm your payment. Membership-covered check-in is available after approval. No daily charge or attendance is created here.</p>
          <button className={styles.secondaryButton} disabled={refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh payment status"}</button>
        </section> :
      <div id="customer-purchase" className={styles.purchasePanel}>
        <PurchaseForm portal heading="Review your request" loadingFallback={checkin ? <BrandLoading fullscreen /> : undefined} key={previous ?? "new"} previousRequestId={previous} onSubmitted={() => {
          setPrevious(undefined);
          setConfirmation("Payment request submitted for gym review. Your membership updates only after approval.");
          navigate("overview");
          void load();
        }} />
      </div>}
      {previous && <button className={styles.textButton} onClick={() => { setPrevious(undefined); navigate(returnScreen.current); }}>Cancel replacement</button>}
    </>}
    {(screen === "overview" || screen === "history") && <section className={screen === "history" ? styles.historyPanel : styles.paymentPanel} data-attention={screen === "overview" && needsAttention ? "true" : undefined} aria-labelledby="payments-title">
      <div className={styles.sectionHeading}><h2 id="payments-title">{screen === "overview" ? needsAttention ? <><span aria-hidden="true">⚠︎</span> Payment needs attention</> : "Latest payment" : "Payment requests"}</h2><button className={styles.refreshButton} aria-label="Refresh payment status" disabled={refreshing || loading} onClick={() => void load()}><span aria-hidden="true">↻</span><span className={styles.refreshLabel}>{refreshing ? "Refreshing…" : "Refresh"}</span></button></div>
      {updatedAt && <p className={styles.updated} role="status">Updated at {new Date(updatedAt).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</p>}
      {loading && <LoadingSkeleton label="Loading payment status…" />}
      {!loading && !error && !(screen === "history" ? history : payments).length && <div className={styles.empty}><span aria-hidden="true">↗</span><h3>No payment requests yet</h3><p>Your submitted payments and their review status will appear here.</p></div>}
      {!loading && screen === "overview" && latest && <>
        {paymentRow(latest, !needsAttention)}
        {!latest.closed && latest.status === "pending" && <p className={styles.pendingNote}>Awaiting gym approval. Your membership updates once payment is approved.</p>}
        {needsAttention && allowPurchases && <button className={styles.primaryButton} onClick={() => replace(latest.id)}>Correct submission<span aria-hidden="true">→</span></button>}
      </>}
      {!loading && screen === "history" && <>
        {browsingOlder && <span className={styles.eyebrow}>Earlier requests</span>}
        {history.map(payment => paymentRow(payment))}
        {browsingOlder && <button className={styles.textButton} disabled={refreshing} onClick={() => void load()}>Back to latest requests</button>}
        {cursor && <button className={styles.secondaryButton} disabled={refreshing} onClick={() => void load(cursor)}>Older requests</button>}
      </>}
    </section>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {screen === "overview" && <a className={styles.actionLink} href="#history" onClick={event => { event.preventDefault(); navigate("history"); }}><span className={styles.actionIcon} aria-hidden="true">≡</span><span>View payment history</span><span aria-hidden="true">›</span></a>}
  </>;
}
