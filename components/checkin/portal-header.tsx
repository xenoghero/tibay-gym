import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./customer-access.module.css";

export function PortalHeader({ label, href, brandLabel, onWelcome, children }: {
  label: string; href?: string; brandLabel: string; onWelcome?: () => void; children: ReactNode;
}) {
  const brand = <><Image src="/tibay-gym-mark-transparent.svg" alt="" width={60} height={42} className={styles.brandMark} />
    <span>TIBAY <span className={styles.brandAccent}>GYM</span><small>{label}</small></span></>;
  return <header className={styles.header}>
    {href ? <Link href={href} className={styles.brand} aria-label={brandLabel}
      onClick={onWelcome ? event => { event.preventDefault(); onWelcome(); } : undefined}>
      {brand}
    </Link> : <span className={styles.brand}>{brand}</span>}
    {children}
  </header>;
}
