"use client";
import { useState } from "react";
import { CheckInFlow } from "./checkin-flow";
import { EntryShell } from "./entry-shell";
import styles from "./entry.module.css";
export function PublicEntry() {
  const [choice, setChoice] = useState<"register" | "checkin" | null>(null);
  if (choice) return <CheckInFlow registrationIntent={choice === "register"} onBack={() => setChoice(null)} />;
  return <EntryShell>
    <h1>Welcome to Tibay Gym</h1>
    <p className={styles.lead}>Ready to train? Record your visit or create a profile to get started.</p>
    <button className={styles.primary} onClick={() => setChoice("checkin")}>Check In <span aria-hidden="true">→</span></button>
    <p className={styles.actionNote}>Already registered? Use your phone number.</p>
    <div className={styles.divider} />
    <button className={styles.secondary} onClick={() => setChoice("register")}>Create Account <span aria-hidden="true">＋</span></button>
    <p className={styles.actionNote}>First time here? Create your profile. No payment required.</p>
  </EntryShell>;
}
