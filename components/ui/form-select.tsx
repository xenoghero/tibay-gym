"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { FieldPopover } from "./field-popover";
import styles from "./field-controls.module.css";

/** Native form contract with a shared, keyboard-operable option menu. */
export function FormSelect({ children, onKeyDown, onClick, onPointerDown, ref, ...props }: ComponentProps<"select">) {
  const input = useRef<HTMLSelectElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSelectElement | null>(null);
  const [label, setLabel] = useState("Options");
  const [options, setOptions] = useState<{ value: string; text: string; disabled: boolean; selected: boolean; detail?: string }[]>([]);
  const [active, setActive] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const search = useRef({ text: "", time: 0 });
  useLayoutEffect(() => {
    // The popup supplies the accessible options while open, avoiding duplicate options.
    for (const option of input.current?.options ?? []) option.setAttribute("aria-hidden", String(open));
  }, [open, children]);
  useLayoutEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);
  function show() {
    if (!input.current || input.current.matches(":disabled")) return;
    setAnchor(input.current);
    const fieldLabel = input.current.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
    fieldLabel?.querySelectorAll("select, input, button").forEach(element => element.remove());
    setLabel(props["aria-label"] ?? fieldLabel?.textContent?.trim() ?? "Options");
    setOptions(Array.from(input.current.options, option => ({ value: option.value, text: option.text,
      disabled: option.disabled || !!option.parentElement?.matches("optgroup:disabled"), selected: option.selected, detail: option.dataset.detail })));
    setActive(Math.max(0, input.current.selectedIndex));
    setOpen(true);
  }
  function choose(index: number) {
    const select = input.current!;
    if (select.matches(":disabled")) return;
    const option = select.options[index];
    if (!option || option.disabled || option.parentElement?.matches("optgroup:disabled")) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    select.focus();
  }
  return <>
    <select {...props} ref={node => {
      input.current = node;
      if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
    }} data-form-select aria-expanded={open} aria-controls={open ? id : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      onPointerDown={event => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.button === 0) { event.preventDefault(); event.currentTarget.focus(); if (open) close(); else show(); }
      }}
      onClick={event => { onClick?.(event); event.preventDefault(); if (event.detail === 0 && !open) show(); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Tab") { close(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          const enabled = options.flatMap((o, i) => o.disabled ? [] : [i]);
          if (!enabled.length) return;
          const position = enabled.indexOf(active);
          const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1)! : enabled[(position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length];
          setActive(next);
          document.getElementById(`${id}-${next}`)?.scrollIntoView?.({ block: "nearest" });
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); if (open) choose(active); else show();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = Date.now();
          search.current = { text: (now - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase(), time: now };
          const list = Array.from(input.current!.options);
          const found = list.findIndex(o => !o.disabled && !o.parentElement?.matches("optgroup:disabled") && o.text.toLowerCase().startsWith(search.current.text));
          if (!open) show();
          if (found >= 0) setActive(found);
        }
      }}>{children}</select>
    {open && !props.disabled && anchor && <FieldPopover anchor={anchor} onClose={close} id={id} role="listbox"
      label={label}>
      {options.map((option, index) => <div key={index} id={`${id}-${index}`} role="option"
        aria-selected={option.selected} aria-disabled={option.disabled}
        data-active={active === index} className={styles.option}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span>{option.text}{option.detail && <small>{option.detail}</small>}</span>
        {option.selected && <span aria-hidden="true" className={styles.check}>✓</span>}
      </div>)}
    </FieldPopover>}
  </>;
}
