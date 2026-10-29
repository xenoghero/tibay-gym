"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./settings.module.css";

export function SettingsDrawer({ title, closing, busy, onClose, onExited, children }: {
  title: string; closing: boolean; busy: boolean; onClose(): void; onExited(): void; children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    titleRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    if (!closing) return;
    // Also completes when animations are disabled or the browser misses the event.
    const timeout = window.setTimeout(onExited, 320);
    return () => window.clearTimeout(timeout);
  }, [closing, onExited]);

  return <dialog ref={dialogRef} className={`${styles.section} ${styles.drawer}`} aria-labelledby={id}
    data-closing={closing} onCancel={e => { e.preventDefault(); if (!busy && !closing) onClose(); }}
    onClick={e => {
      if (e.target !== e.currentTarget || busy || closing) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }}
    onAnimationEnd={e => { if (closing && e.target === e.currentTarget) onExited(); }}>
    <div className={styles.drawerInner} inert={closing}>
      <header className={styles.drawerHeader}>
        <h2 ref={titleRef} tabIndex={-1} id={id}>{title}</h2>
        <button type="button" aria-label="Close voucher drawer" disabled={busy || closing} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className={styles.drawerBody}>{children}</div>
    </div>
  </dialog>;
}
