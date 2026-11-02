"use client";
import { useState } from "react";
import { CheckInFlow } from "./checkin-flow";
import { EntryShell } from "./entry-shell";
import styles from "./entry.module.css";
export function PublicEntry() {
  const [choice, setChoice] = useState<"register" | "checkin" | null>(null);
  if (choice) return <CheckInFlow registrationIntent={choice === "register"} onBack={() => setChoice(null)} />;
  return <EntryShell>
    <h1 className={styles.screenReaderHeading}>Gym check-in and registration</h1>
    <div className={styles.entryOptions}>
      <section className={styles.returningOption} aria-labelledby="returning-title">
        <h2 id="returning-title">
          <svg className={styles.optionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M14 4h5v16h-5M3 12h12m-5-5 5 5-5 5" />
          </svg>
          <span>Returning member?</span>
        </h2>
        <p>Check in with your registered phone number.</p>
        <button className={styles.primary} onClick={() => setChoice("checkin")}>Check In <span aria-hidden="true">→</span></button>
      </section>
      <section className={styles.newOption} aria-labelledby="first-time-title">
        <h2 id="first-time-title">
          <svg className={styles.optionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="9" cy="7" r="3.5" />
            <path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2M19 6v8m-4-4h8" />
          </svg>
          <span>First time here?</span>
        </h2>
        <p>Create your profile. No payment required.</p>
        <button className={styles.secondary} onClick={() => setChoice("register")}>Create Account <span aria-hidden="true">＋</span></button>
      </section>
    </div>
  </EntryShell>;
}
