"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./payment-review.module.css";

export { styles };
export const peso = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
export const paymentDate = (value: number | string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value));

export function PaymentStatus({ status, label }: { status: string; label?: string }) {
  return <span className={styles.status} data-status={status}>{label ?? (status === "approved" ? "Approved" : status === "confirmed" ? "Collected" : status === "pending" ? "Pending" : status === "rejected" ? "Rejected" : "Awaiting collection")}</span>;
}

export function PaymentDrawer({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); trigger?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.drawer} aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={styles.drawerHead}><div><div className={styles.kicker}>Payment details</div><h2 id={id}>{title}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close payment details">✕</button></header>
    <div className={styles.drawerBody}>{children}</div>
  </dialog>;
}
