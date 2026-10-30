"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./settings.module.css";
export function SettingsConfirm({ title, children, busy, onCancel, onConfirm, label = "Confirm", danger = false, confirmDisabled = false }: {
  title: string; children: ReactNode; busy?: boolean; onCancel(): void; onConfirm(): void; label?: string; danger?: boolean; confirmDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const trigger = document.activeElement as HTMLElement | null; const dialog = ref.current!; dialog.showModal(); return () => { dialog.close(); trigger?.focus(); }; }, []);
  return <dialog className={styles.confirm} ref={ref} aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={id}>{title}</h2>{children}<div className={styles.footer}><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={danger ? styles.danger : styles.primary} disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? "Saving…" : label}</button></div>
  </dialog>;
}
