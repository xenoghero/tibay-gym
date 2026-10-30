"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./field-controls.module.css";

/** Top-layer positioning keeps controls usable inside scrolling panels and dialogs. */
export function FieldPopover({ anchor, onClose, children, id, role = "dialog", label, wide = false }: {
  anchor: HTMLElement; onClose(): void; children: ReactNode; id: string;
  role?: "dialog" | "listbox"; label: string; wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current!;
    element.showPopover?.();
    function position() {
      if (anchor.checkVisibility && !anchor.checkVisibility()) { onClose(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(wide ? 336 : Math.max(rect.width, 180), window.innerWidth - 16);
      const available = Math.max(120, Math.min(wide ? window.innerHeight - 16 : 360, window.innerHeight - 16));
      element.style.width = `${width}px`;
      element.style.maxHeight = `${available}px`;
      const height = Math.min(element.scrollHeight, available);
      element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, rect.bottom + height + 8 > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6)}px`;
    }
    position();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(position);
    observer?.observe(element);
    function outside(event: Event) {
      if (!element.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
      const panels = document.querySelectorAll("[data-field-popover]");
      if (panels[panels.length - 1] !== element) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); anchor.focus(); }
    }
    function toggle(event: Event) {
      if ((event as ToggleEvent).newState === "closed") onClose();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    element.addEventListener("toggle", toggle);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      element.removeEventListener("toggle", toggle);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, onClose, wide]);
  return createPortal(<div ref={panel} data-field-popover popover={typeof HTMLElement.prototype.showPopover === "function" ? "manual" : undefined} id={id} role={role} aria-label={label}
    className={`${styles.popover} ${wide ? styles.calendar : ""}`}
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {children}
  </div>, anchor.closest("[data-field-popover], dialog") ?? document.body);
}
