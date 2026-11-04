"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FieldPopover } from "./field-popover";
import shared from "./field-controls.module.css";
import styles from "./styled-select.module.css";

export interface SelectOption { value: string; name: string; detail?: string; mark?: ReactNode; disabled?: boolean; tone?: "green" | "blue" }
export function StyledSelect({ label, value, options, disabled, compact = false, placement = "auto", onChange }: {
  label: string; value: string; options: SelectOption[]; disabled?: boolean; compact?: boolean; placement?: "auto" | "top"; onChange(value: string): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find(option => option.value === value);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setClosing(true), []);
  const finishClose = useCallback(() => { setOpen(false); setClosing(false); }, []);
  const expanded = open && !closing && !disabled;
  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  function show() { setAnchor(root.current!.querySelector("button")); setActive(Math.max(0, options.findIndex(option => option.value === value && !option.disabled))); setClosing(false); setOpen(true); }
  function choose(index: number) {
    const option = options[index];
    if (option && !option.disabled) { onChange(option.value); close(); }
  }
  return <div ref={root} data-tone={selected?.tone} className={`${styles.root} ${compact ? styles.compact : ""}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <button type="button" role="combobox" aria-labelledby={`${id}-label`} aria-haspopup="listbox"
      aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded ? `${id}-${active}` : undefined}
      className={styles.trigger} disabled={disabled} onClick={() => expanded ? close() : show()}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) { show(); return; }
          const enabled = options.flatMap((option, index) => option.disabled ? [] : [index]);
          if (!enabled.length) return;
          const position = enabled.indexOf(active);
          setActive(event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : enabled[(position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]);
        } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (expanded) choose(active); else show(); }
        else if (event.key.length === 1) {
          const index = options.findIndex(option => !option.disabled && option.name.toLowerCase().startsWith(event.key.toLowerCase()));
          if (index >= 0) { event.preventDefault(); show(); setActive(index); }
        }
      }}>
      <span key={value} className={styles.selection}>{selected?.mark && <span className={styles.mark} aria-hidden="true">{selected.mark}</span>}
      <span className={styles.copy}><strong>{selected?.name ?? "Choose an option"}</strong>{selected?.detail && <small>{selected.detail}</small>}</span></span>
      <span className={styles.chevronBox} aria-hidden="true"><span className={styles.chevron} /></span>
    </button>
    {open && !disabled && anchor && <FieldPopover anchor={anchor} onClose={close} closing={closing} onExited={finishClose} id={`${id}-options`} role="listbox" label={label} placement={placement}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value}
        aria-disabled={option.disabled} data-active={active === index} data-tone={option.tone} className={`${shared.option} ${option.tone ? styles.tonedOption : ""}`}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        {option.mark && <span className={styles.mark} aria-hidden="true">{option.mark}</span>}
        <span className={styles.copy}><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span>
        {value === option.value && <span className={styles.check} aria-hidden="true">✓</span>}
      </div>)}
    </FieldPopover>}
  </div>;
}

