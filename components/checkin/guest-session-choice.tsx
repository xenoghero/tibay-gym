"use client";

import type { DailyPaymentDue, DailyRates, QrLookupPerson } from "@/lib/attendance-api";
import { useEffect, useRef } from "react";
import styles from "./entry.module.css";

const money = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(minor / 100);

export function GuestSessionChoice({ person, rates, paymentDue, busy, error, onDaily, onMembership }: {
  person: QrLookupPerson; rates: DailyRates | null; paymentDue: DailyPaymentDue;
  busy: boolean; error: string; onDaily(): void; onMembership(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const category = person.rateCategory === "student" ? "Student" : person.rateCategory === "regular" ? "Regular" : null;
  const monthly = category === "Student" ? rates?.studentMonthlyMinor : category === "Regular" ? rates?.regularMonthlyMinor : null;
  const monthlyAvailable = typeof monthly === "number" && Number.isSafeInteger(monthly) && monthly > 0;
  return <div aria-busy={busy}>
    <p className={styles.choiceEyebrow}>Before you check in</p>
    <h1 ref={heading} tabIndex={-1}>Your training.<br />Your choice.</h1>
    <p className={styles.lead}>Choose how you want to train today.</p>
    <div className={styles.visitor}>
      <span className={styles.visitorInitial} aria-hidden="true">{person.name.trim().slice(0, 1).toUpperCase()}</span>
      <div><strong>{person.name}</strong><small>Guest account</small></div>
      <span className={styles.categoryTag}>{category ?? "Category required"}</span>
    </div>
    <section className={styles.membershipSpotlight} aria-labelledby="membership-choice-title">
      <p className={styles.spotlightEyebrow}>Make it a monthly habit</p>
      <h2 id="membership-choice-title">Want to be a{" "}<br />new member?</h2>
      {monthlyAvailable ? <><p className={styles.membershipPrice}><strong>{money(monthly)}</strong><span>/ month</span></p>
        <p className={styles.membershipBenefit}>Covered visits. No extra daily session fee.</p>
        <button type="button" className={styles.spotlightButton} disabled={busy} onClick={onMembership}>{busy ? "Opening membership…" : "Start membership"} <span aria-hidden="true">↗</span></button>
      </> : <p className={styles.membershipBenefit}>Ask the front desk {category ? "about monthly membership pricing." : "to set your Student / Regular category before purchasing membership."}</p>}
    </section>
    {error && <p className={styles.actionNote} role="alert">{error}</p>}
    <button type="button" className={styles.dailyChoice} disabled={busy} onClick={onDaily}>
      <span><strong>Daily session only</strong><small>Just training for today</small></span>
      <span>{paymentDue.amountMinor == null ? <strong>See front desk</strong> : <><b>{money(paymentDue.amountMinor)}</b><small>/ session <span aria-hidden="true">→</span></small></>}</span>
    </button>
    <p className={styles.actionNote}>Membership starts after admin payment approval. Choosing membership does not record a visit or create a daily charge.</p>
  </div>;
}
