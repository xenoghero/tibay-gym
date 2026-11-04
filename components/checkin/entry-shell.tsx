import type { ReactNode } from "react";
import Link from "next/link";
import { PortalHeader } from "./portal-header";
import portal from "./customer-access.module.css";
import styles from "./entry.module.css";
import { PromotionBanner } from "./promotion-banner";

export function EntryShell({ children, mode = "welcome", name, phone, amount, navigation, onWelcome }: {
  children: ReactNode;
  mode?: "welcome" | "register" | "phone" | "choice" | "payment" | "complete";
  name?: string; phone?: string; amount?: number | null;
  navigation?: ReactNode; onWelcome?: () => void;
}) {
  const registering = mode === "register";
  return <main className={`${portal.portal} ${portal.memberPortal} ${portal.entryPortal} ${styles.page}`}>
    <PortalHeader label="Check-in desk" href={onWelcome ? "/checkin" : undefined} brandLabel="Tibay Gym welcome" onWelcome={onWelcome}>
      {(mode === "welcome" || onWelcome) && <Link href="/customer" className={portal.backLink}>Member portal ↗</Link>}
    </PortalHeader>
    <div className={styles.workspace} data-mode={mode}>
      <section className={styles.content} aria-label={registering ? "Registration" : "Check-in desk"}>
        {navigation ?? (mode !== "welcome" && mode !== "choice" && <div className={styles.step}>
          <span>{mode === "complete" ? "✓" : registering ? "01" : mode === "payment" ? "02" : "01"}</span>
          {mode === "complete" ? "Confirmation" : registering ? "Your profile" : mode === "payment" ? "Session & payment" : "Find your profile"}
        </div>)}
        {mode === "payment" && <dl className={styles.summary} aria-label="Visit overview">
          {name && <div><dt>Visitor</dt><dd>{name}</dd></div>}
          {phone && <div><dt>Phone number</dt><dd>{phone}</dd></div>}
          <div><dt>Session</dt><dd>Daily visit</dd></div>
          <div><dt>Amount due</dt><dd>{amount == null ? "Category required" : `₱${(amount / 100).toFixed(2)}`}</dd></div>
        </dl>}
        {children}
      </section>
      {mode === "welcome" && <PromotionBanner />}
    </div>
  </main>;
}
