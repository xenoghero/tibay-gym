"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./payment-review.module.css";

export { styles };
export const peso = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
export const paymentDate = (value: number | string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value));

export function PaymentStatus({ status, label }: { status: string; label?: string }) {
  return <span className={styles.status} data-status={status}>{label ?? (status === "approved" ? "Approved" : status === "confirmed" ? "Collected" : status === "pending" ? "Pending" : status === "rejected" ? "Rejected" : "Awaiting collection")}</span>;
}

export function PaymentDrawer({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const finished = useRef(false);
  const [closing, setClosing] = useState(false);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    titleRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    if (!closing) return;
    // Finish even if the browser suppresses the animation-end event.
    const timeout = window.setTimeout(() => {
      if (!finished.current) { finished.current = true; onClose(); }
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [closing, onClose]);
  function requestClose() { if (!busy && !closing) setClosing(true); }
  return <dialog ref={ref} className={styles.drawer} aria-labelledby={id} data-closing={closing}
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
    }}
    onAnimationEnd={event => {
      if (closing && event.target === event.currentTarget && !event.nativeEvent.pseudoElement && !finished.current) {
        finished.current = true; onClose();
      }
    }}>
    <header className={styles.drawerHead} inert={closing}><div><div className={styles.kicker}>Payment details</div><h2 ref={titleRef} tabIndex={-1} id={id}>{title}</h2></div><button type="button" disabled={busy || closing} onClick={requestClose} aria-label="Close payment details">✕</button></header>
    <div className={styles.drawerBody} inert={closing}>{children}</div>
  </dialog>;
}
