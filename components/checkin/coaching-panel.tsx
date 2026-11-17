"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { PurchaseForm } from "@/components/people/purchase-form";
import type { CoachingPackage, PackageStatus } from "@/lib/coaching/catalog";
import styles from "./customer-access.module.css";
import own from "./coaching-panel.module.css";

interface Current { status: PackageStatus; sessions: number; sessionsLeft: number; validityDays: number; priceMinor: number; approvedAt: number | null; startedAt: number | null; coachingExpiresAt: number | null }
const statusText: Record<PackageStatus, string> = {
  pending: "Pending approval", rejected: "Payment needs correction", closed: "Closed", approved: "Approved, not started",
  active: "Active", used_up: "Used up", expired: "Expired",
};
const money = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(minor / 100);

/** Members portal coaching: the client's package status, and buying a package when none is in use. */
export function CoachingPanel({ onSubmitted }: { onSubmitted(): void }) {
  const [data, setData] = useState<{ packages: CoachingPackage[]; canBuy: boolean; coachName: string | null; current: Current | null } | null>(null);
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
    {current && <section className={styles.paymentPanel} aria-labelledby="coaching-status">
      <div className={styles.sectionHeading}><h2 id="coaching-status">Your coaching package</h2></div>
      <dl className={own.facts}>
        <div><dt>Status</dt><dd>{statusText[current.status]}</dd></div>
        <div><dt>Sessions left</dt><dd>{current.sessionsLeft} of {current.sessions}</dd></div>
        <div><dt>Coach</dt><dd>{data.coachName ?? "Not assigned yet"}</dd></div>
        <div><dt>Coaching validity</dt><dd>{current.coachingExpiresAt ? `Until ${new Date(current.coachingExpiresAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })}` : `${current.validityDays} days from your first visit`}</dd></div>
      </dl>
      {current.status === "pending" && <p className={styles.pendingNote}>Awaiting gym approval. Your package starts at your first check-in or coaching session after approval.</p>}
      {current.status === "approved" && <p className={styles.pendingNote}>Approved. Your sessions and your included month of gym membership start at your first check-in or coaching session, or 15 days after approval.</p>}
      {current.status === "rejected" && <p className={styles.pendingNote}>Your payment was rejected. Correct it from your latest payment on the Overview tab.</p>}
    </section>}
    {canBuy && current?.status !== "rejected" && (item
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
