"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal supplies focus containment, Escape dismissal and focus return. */
export function ReportDateSheet({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className="rs-report-sheet" aria-label="Date range" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="rs-report-sheet-body">
      <div className="rs-report-sheet-grabber" aria-hidden="true" />
      <h2>Date range</h2>
      {open && children}
      <button type="button" className="rs-report-sheet-done" onClick={onClose}>Done</button>
    </div>
  </dialog>;
}
