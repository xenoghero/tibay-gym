import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import styles from "./entry.module.css";

export function EntryShell({ children, mode = "welcome", name, phone, amount }: {
  children: ReactNode;
  mode?: "welcome" | "register" | "phone" | "payment" | "complete";
  name?: string;
  phone?: string;
  amount?: number | null;
}) {
  const registering = mode === "register";
  return <main className={styles.page}>
    <div className={styles.frame}>
      <header className={styles.brand}><BrandLogo /><span>YOUR NEXT SESSION STARTS HERE</span></header>
      <div className={styles.workspace} data-mode={mode}>
        <aside className={styles.overview} aria-label="Visit overview">
          <span className={styles.eyebrow}>TIBAY GYM · WELCOME IN</span>
          <h2>{mode === "complete" ? "All set.\nKeep showing up." : registering ? "Your first step.\nA stronger you." : "Show up.\nGet stronger."}</h2>
          <p>{registering ? "Create your profile today. Check in with your phone number whenever you’re ready to train." : "A quick check-in, then it’s time to train. Use your phone number to record your visit."}</p>
          {(name || phone || mode === "payment") && <dl className={styles.summary}>
            {name && <div><dt>Visitor</dt><dd>{name}</dd></div>}
            {phone && <div><dt>Phone number</dt><dd>{phone}</dd></div>}
            {mode === "payment" && <><div><dt>Session</dt><dd>Daily visit</dd></div><div><dt>Amount due</dt><dd>{amount == null ? "Category required" : `₱${(amount / 100).toFixed(2)}`}</dd></div></>}
          </dl>}
          <div className={styles.help}><span className={styles.helpMark} aria-hidden="true">i</span><div><strong>{registering ? "No payment to create an account" : "Need a hand?"}</strong><p>{registering ? "Your profile will await admin verification. Registration does not record a visit." : "Ask the front desk if you need help with your profile, membership, or payment."}</p></div></div>
        </aside>
        <section className={styles.content} aria-label={registering ? "Registration" : "Check-in desk"}>
          {mode !== "welcome" && <div className={styles.step}><span>{mode === "complete" ? "✓" : registering ? "01" : mode === "payment" ? "02" : "01"}</span>{mode === "complete" ? "Confirmation" : registering ? "Your profile" : mode === "payment" ? "Session & payment" : "Find your profile"}</div>}
          {children}
        </section>
      </div>
      <footer className={styles.footer}>Tibay Gym <span>One visit at a time.</span></footer>
    </div>
  </main>;
}
