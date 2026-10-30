"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { FieldPopover } from "./field-popover";
import shared from "./field-controls.module.css";
import styles from "./styled-select.module.css";

export interface SelectOption { value: string; name: string; detail?: string; mark?: string; disabled?: boolean }
export function StyledSelect({ label, value, options, disabled, compact = false, onChange }: {
  label: string; value: string; options: SelectOption[]; disabled?: boolean; compact?: boolean; onChange(value: string): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find(option => option.value === value);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  function show() { setAnchor(root.current!.querySelector("button")); setActive(Math.max(0, options.findIndex(option => option.value === value && !option.disabled))); setOpen(true); }
  function choose(index: number) {
    const option = options[index];
    if (option && !option.disabled) { onChange(option.value); setOpen(false); }
  }
  return <div ref={root} className={`${styles.root} ${compact ? styles.compact : ""}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <button type="button" role="combobox" aria-labelledby={`${id}-label`} aria-haspopup="listbox"
      aria-expanded={open && !disabled} aria-controls={`${id}-options`} aria-activedescendant={open && !disabled ? `${id}-${active}` : undefined}
      className={styles.trigger} disabled={disabled} onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          const enabled = options.flatMap((option, index) => option.disabled ? [] : [index]);
          if (!enabled.length) return;
          const position = enabled.indexOf(active);
          setActive(event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : enabled[(position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]);
        } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active); else show(); }
        else if (event.key.length === 1) {
          const index = options.findIndex(option => !option.disabled && option.name.toLowerCase().startsWith(event.key.toLowerCase()));
          if (index >= 0) { event.preventDefault(); setActive(index); setOpen(true); }
        }
      }}>
      {selected?.mark && <span className={styles.mark} aria-hidden="true">{selected.mark}</span>}
      <span className={styles.copy}><strong>{selected?.name ?? "Choose an option"}</strong>{selected?.detail && <small>{selected.detail}</small>}</span>
      <span className={styles.chevron} aria-hidden="true" />
    </button>
    {open && !disabled && anchor && <FieldPopover anchor={anchor} onClose={close} id={`${id}-options`} role="listbox" label={label}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value}
        aria-disabled={option.disabled} data-active={active === index} className={shared.option}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        {option.mark && <span className={styles.mark} aria-hidden="true">{option.mark}</span>}
        <span className={styles.copy}><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span>
        {value === option.value && <span className={styles.check} aria-hidden="true">✓</span>}
      </div>)}
    </FieldPopover>}
  </div>;
}

