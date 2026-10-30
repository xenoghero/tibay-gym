"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Voucher } from "@/lib/finance/vouchers";
import styles from "./settings.module.css";

function ActionsPopup({ code, children, onClose }: {
  code: string;
  children: React.ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); trigger?.focus(); };
  }, []);

  return <dialog ref={ref} className={styles.actionsPopup} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.actionsPopupHeader}>
      <div><p>Voucher actions</p><h2 id={titleId}>{code}</h2></div>
      <button type="button" aria-label="Close voucher actions" onClick={onClose}>×</button>
    </header>
    <div className={styles.actionsPopupItems}>{children}</div>
  </dialog>;
}

export function VoucherActions({ voucher: v, busy, onEdit, onAction }: {
  voucher: Voucher;
  busy: boolean;
  onEdit(voucher: Voucher, duplicate?: boolean): void;
  onAction(voucher: Voucher, action: string): void;
}) {
  const [open, setOpen] = useState(false);
  const canEdit = !["archived", "deleted"].includes(v.status);
  function choose(action: () => void) { setOpen(false); action(); }
  function items() {
    return <>
      {canEdit && <>
        <button type="button" disabled={busy} onClick={() => choose(() => onEdit(v))}>Edit voucher</button>
        <button type="button" disabled={busy} onClick={() => choose(() => onAction(v, v.status === "paused" ? "resume" : "pause"))}>{v.status === "paused" ? "Resume" : "Pause"}</button>
      </>}
      <button type="button" disabled={busy} onClick={() => choose(() => onEdit(v, true))}>Duplicate</button>
      {canEdit && <button type="button" className={styles.danger} disabled={busy} onClick={() => choose(() => onAction(v, v.everUsed ? "archive" : "delete"))}>{v.everUsed ? "Archive" : "Delete unused code"}</button>}
    </>;
  }

  return <>
    <details className={`${styles.menu} ${styles.desktopVoucherActions}`}>
      <summary aria-label={`More actions for ${v.code}`}>More actions</summary>
      <div className={styles.menuItems}>{items()}</div>
    </details>
    <button type="button" className={styles.mobileVoucherActions} disabled={busy}
      aria-label={`More actions for ${v.code}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>More actions <span aria-hidden="true">⋯</span></button>
    {open && <ActionsPopup code={v.code} onClose={() => setOpen(false)}>{items()}</ActionsPopup>}
  </>;
}
