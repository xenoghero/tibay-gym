"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { PurchaseForm } from "@/components/people/purchase-form";
import { MAX_TOP_UP_SESSIONS, type CoachingPackage, type PackageStatus } from "@/lib/coaching/catalog";
import { autoStartDeadline } from "@/lib/coaching/clocks";
import styles from "./customer-access.module.css";
import own from "./coaching-panel.module.css";
import { MemberSessions } from "./member-sessions";

interface Current { frozen?: true; canRequestFreeze: boolean; freeze: { status: string; startedAt: number | null; endsBy: number | null; days: number | null } | null;
  status: PackageStatus; sessions: number; sessionsLeft: number; validityDays: number; priceMinor: number; approvedAt: number | null; startedAt: number | null; coachingExpiresAt: number | null }
const statusText: Record<PackageStatus, string> = {
  pending: "Pending approval", rejected: "Payment needs correction", closed: "Closed", approved: "Approved, not started",
  active: "Active", used_up: "Used up", expired: "Expired",
};
const money = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(minor / 100);

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
/** Freeze: once per started package, up to 14 days from approval; unfreezing needs no approval. Gym access keeps running. */
function FreezeStatus({ current, busy, onAction }: { current: Current; busy: boolean; onAction(action: "request-freeze" | "unfreeze"): void }) {
  const f = current.freeze;
  if (current.frozen && f?.startedAt) return <div className={own.freeze}>
    <p><strong>Frozen since {shortDate(f.startedAt)}.</strong> Coaching is paused until you unfreeze, or until {f.endsBy ? shortDate(f.endsBy - 1) : "14 days pass"}. Your gym membership keeps running.</p>
    <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => onAction("unfreeze")}>{busy ? "Saving…" : "Unfreeze now"}</button>
  </div>;
  if (f?.status === "requested") return <p className={own.freezeNote}>Freeze requested. The gym will approve it; it starts on the day it is approved.</p>;
  if (f?.status === "ended") return <p className={own.freezeNote}>You froze this package for {f.days} {f.days === 1 ? "day" : "days"}. A Freeze can be used once per package.</p>;
  if (!current.canRequestFreeze) return f?.status === "rejected" ? <p className={own.freezeNote}>Your Freeze request was not approved.</p> : null;
  return <div className={own.freeze} data-row>
    {f?.status === "rejected" && <p className={own.freezeNote}>Your last Freeze request was not approved.</p>}
    <p><strong>Sick or away?</strong> Freeze coaching once, up to 14 days. Your validity moves back; gym access keeps running.</p>
    <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => onAction("request-freeze")}>{busy ? "Sending…" : "Request a Freeze"}</button>
  </div>;
}

const DAY_MS = 86_400_000;
const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

/** The package at a glance: sessions left as a big count with one bar segment per session, then coach, validity and what happens next. */
function PackageCard({ current, sessionsLeft, topUpLeft, hasTopUps, coachName, children }: { current: Current; sessionsLeft: number; topUpLeft: number; hasTopUps: boolean;
  coachName: string | null; children: ReactNode }) {
  const tone = current.frozen ? "frozen" : current.status;
  const packageLeft = Math.max(0, sessionsLeft - topUpLeft), used = hasTopUps ? 0 : Math.max(0, current.sessions - sessionsLeft);
  const leftSub = hasTopUps ? `${packageLeft} package + ${topUpLeft} top-up${topUpLeft === 1 ? "" : "s"}` : `of ${current.sessions}${used ? ` · ${used} done` : ""}`;
  // One segment per session: used, then package sessions, then top-ups.
  const bar = [...Array<string>(used).fill("used"), ...Array<string>(packageLeft).fill("left"), ...Array<string>(hasTopUps ? topUpLeft : 0).fill("topUp")];
  const [now] = useState(Date.now);
  const daysLeft = current.coachingExpiresAt ? Math.ceil((current.coachingExpiresAt - now) / DAY_MS) : null;
  return <section className={styles.paymentPanel} aria-labelledby="coaching-status">
    <div className={styles.sectionHeading}><h2 id="coaching-status">Your package</h2><span className={own.chip} data-tone={tone}>{current.frozen ? "Frozen" : statusText[current.status]}</span></div>
    <div className={own.count}>
      <strong>{sessionsLeft}</strong>
      <p><span>{sessionsLeft === 1 ? "session" : "sessions"} left</span><small>{leftSub}</small></p>
    </div>
    {bar.length > 0 && <div className={own.bar} aria-hidden="true">{bar.map((kind, i) => <span key={i} data-kind={kind} />)}</div>}
    <dl className={`${own.facts} ${own.details}`}>
      <div><dt>Coach</dt><dd className={own.coach}>{coachName ? <><span aria-hidden="true">{initials(coachName)}</span>{coachName}</> : "Not assigned yet"}</dd></div>
      <div><dt>Coaching validity</dt><dd>{current.coachingExpiresAt ? <>Until {longDate(current.coachingExpiresAt - 1)}
        {daysLeft !== null && daysLeft > 0 && <small>{daysLeft} {daysLeft === 1 ? "day" : "days"} left</small>}</>
        : <>{current.validityDays} days<small>from your first visit</small></>}</dd></div>
    </dl>
    {current.status === "pending" && <p className={own.callout}>Awaiting gym approval. Your package starts at your first check-in or coaching session after approval.</p>}
    {current.status === "approved" && <p className={own.callout}><ClockIcon /><span><strong>Starts on your first visit.</strong> Your sessions and included month of gym membership begin at your
      first check-in or coaching session, or automatically on <strong>{current.approvedAt ? shortDate(autoStartDeadline(current.approvedAt)) : "the 15th day after approval"}</strong>.</span></p>}
    {current.status === "rejected" && <p className={own.callout}>Your payment was rejected. Correct it from your latest payment on the Overview tab.</p>}
    {children}
  </section>;
}
const ClockIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;

/** Choose how many Session top-ups, with the total; shared by the portal and the sign-up link. */
export function TopUpPicker({ count, onCount, priceMinor, note }: { count: number; onCount(count: number): void; priceMinor: number; note?: string | null }) {
  return <div className={own.topUps}>
    <p className={own.lead}>Extra coaching sessions at {money(priceMinor)} each. Top-ups pay for coaching only, not gym access.{note ? ` ${note}` : ""}</p>
    <div className={own.stepper}>
      <button type="button" aria-label="Fewer sessions" disabled={count <= 1} onClick={() => onCount(count - 1)}>−</button>
      <label><span className={own.srOnly}>Number of sessions</span><input type="number" inputMode="numeric" min={1} max={MAX_TOP_UP_SESSIONS} value={count}
        onChange={e => onCount(Math.min(MAX_TOP_UP_SESSIONS, Math.max(1, Math.floor(Number(e.target.value) || 1))))} /></label>
      <button type="button" aria-label="More sessions" disabled={count >= MAX_TOP_UP_SESSIONS} onClick={() => onCount(count + 1)}>+</button>
      <strong aria-live="polite">{money(count * priceMinor)}</strong>
    </div>
  </div>;
}

/** Members portal coaching: the client's package status, and buying a package when none is in use. */
export function CoachingPanel({ onSubmitted }: { onSubmitted(): void }) {
  const [data, setData] = useState<{ packages: CoachingPackage[]; canBuy: boolean; coachName: string | null; current: Current | null;
    sessionsLeft: number; topUps: { sessionsLeft: number; coachingExpiresAt: number | null }[]; topUpPriceMinor: number; topUpValidityDays: number } | null>(null);
  const [topUpCount, setTopUpCount] = useState(1), [buyingTopUps, setBuyingTopUps] = useState(false);
  const [freezeBusy, setFreezeBusy] = useState(false), [freezeMessage, setFreezeMessage] = useState("");
  async function freeze(action: "request-freeze" | "unfreeze") {
    if (freezeBusy) return;
    setFreezeBusy(true); setFreezeMessage("");
    try {
      const response = await fetch("/api/customer/coaching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error();
      // The Freeze status line below the package already says what changed.
      setReload(v => v + 1);
    } catch { setFreezeMessage("Could not update your Freeze. Refresh and try again."); }
    finally { setFreezeBusy(false); }
  }
  const [error, setError] = useState(""), [reload, setReload] = useState(0), [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/customer/coaching", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      setData(await response.json()); setError("");
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load coaching. Refresh to try again."); });
    return () => controller.abort();
  }, [reload]);

  if (error) return <div className={styles.notice}><div><strong>Coaching unavailable</strong><p>{error}</p></div><button className={styles.secondaryButton} onClick={() => setReload(v => v + 1)}>Retry</button></div>;
  if (!data) return <LoadingSkeleton label="Loading coaching…" />;
  const { current, packages, canBuy } = data, item = packages.find(p => p.id === chosen);
  return <>
    {current && <PackageCard current={current} sessionsLeft={data.sessionsLeft || current.sessionsLeft} topUpLeft={data.topUps.reduce((sum, t) => sum + t.sessionsLeft, 0)}
      hasTopUps={data.topUps.length > 0} coachName={data.coachName}>
      <FreezeStatus current={current} busy={freezeBusy} onAction={action => void freeze(action)} />
      {freezeMessage && <p className={own.callout} role="status">{freezeMessage}</p>}
    </PackageCard>}
    {(data.coachName || (current && !["pending", "rejected", "closed"].includes(current.status)) || data.topUps.length > 0) &&
      <MemberSessions sessionsLeft={data.sessionsLeft || current?.sessionsLeft || 0} sessions={data.topUps.length ? null : current?.sessions ?? null} />}
    {!current && data.topUps.length > 0 && <section className={styles.paymentPanel} aria-labelledby="coaching-topups">
      <div className={styles.sectionHeading}><h2 id="coaching-topups">Your session top-ups</h2></div>
      <dl className={own.facts}><div><dt>Sessions left</dt><dd>{data.sessionsLeft}</dd></div><div><dt>Coach</dt><dd>{data.coachName ?? "Not assigned yet"}</dd></div></dl>
    </section>}
    {buyingTopUps ? <div className={styles.purchasePanel}>
      <p className={own.chosen}>{topUpCount} session top-up{topUpCount === 1 ? "" : "s"} · coaching only <button className={styles.textButton} onClick={() => setBuyingTopUps(false)}>Change</button></p>
      <PurchaseForm portal heading="Pay for your session top-ups" key={`topups-${topUpCount}`} topUpSessions={topUpCount} onSubmitted={() => { setBuyingTopUps(false); setReload(v => v + 1); onSubmitted(); }} />
    </div> : !item && <section className={styles.paymentPanel} aria-labelledby="coaching-topup-buy">
      <div className={styles.sectionHeading}><h2 id="coaching-topup-buy">Session top-ups</h2></div>
      <TopUpPicker count={topUpCount} onCount={setTopUpCount} priceMinor={data.topUpPriceMinor} note={current && (current.status === "active" || current.status === "approved")
        ? "They share your package's coaching validity." : `They are valid for ${data.topUpValidityDays} days after approval.`} />
      <button type="button" className={styles.primaryButton} onClick={() => setBuyingTopUps(true)}>Buy {topUpCount} top-up{topUpCount === 1 ? "" : "s"} · {money(topUpCount * data.topUpPriceMinor)}<span aria-hidden="true">→</span></button>
    </section>}
    {!buyingTopUps && canBuy && current?.status !== "rejected" && (item
      ? <div className={styles.purchasePanel}>
          <p className={own.chosen}>{item.sessions} coaching sessions · {item.validityDays} days · includes 1 month of gym membership <button className={styles.textButton} onClick={() => setChosen(null)}>Change</button></p>
          <PurchaseForm portal heading="Pay for your coaching package" key={item.id} packageId={item.id} onSubmitted={() => { setChosen(null); setReload(v => v + 1); onSubmitted(); }} />
        </div>
      : <section className={styles.paymentPanel} aria-labelledby="coaching-packages">
          <div className={styles.sectionHeading}><h2 id="coaching-packages">Coaching packages</h2></div>
          <p className={own.lead}>Every package includes one month of gym membership. Sessions and the month start at your first check-in or coaching session.</p>
          <ul className={own.options}>{packages.map(p => <li key={p.id}><button type="button" onClick={() => setChosen(p.id)}>
            <strong>{money(p.priceMinor)}</strong><span>{p.sessions} sessions</span><small>Valid {p.validityDays} days</small></button></li>)}</ul>
          {!packages.length && <p className={own.lead}>No coaching packages are available right now.</p>}
        </section>)}
  </>;
}
