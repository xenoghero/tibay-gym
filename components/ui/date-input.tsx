"use client";

import { useCallback, useId, useRef, useState, type ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { FieldPopover } from "./field-popover";
import { FormSelect } from "./form-select";
import styles from "./field-controls.module.css";

function parse(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}
function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DateInput({ ref, onClick, onKeyDown, onChange, ...props }: ComponentProps<"input">) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const [current, setCurrent] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const datetime = props.type === "datetime-local";
  const value = props.value === undefined ? current : String(props.value);
  function show() {
    if (!input.current || input.current.matches(":disabled") || input.current.readOnly) return;
    setAnchor(input.current);
    setCurrent(input.current.value);
    setOpen(true);
  }
  function update(next: string) {
    const element = input.current!;
    // Use the prototype setter so React sees a real input event and keeps callers' form logic.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    setCurrent(next);
  }
  function finish() { close(); input.current?.focus(); }
  const min = parse(String(props.min ?? ""));
  const max = parse(String(props.max ?? ""));
  return <>
    <input {...props} data-form-input data-date-input aria-haspopup="dialog" data-open={open} aria-controls={open ? id : undefined}
      ref={node => { input.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }}
      onChange={event => { setCurrent(event.target.value); onChange?.(event); }}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); show(); } }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && ((event.altKey && event.key === "ArrowDown") || event.key === "F4")) { event.preventDefault(); show(); }
      }} />
    {open && !props.disabled && !props.readOnly && anchor && <FieldPopover anchor={anchor} id={id} label="Choose date" onClose={close} wide>
      <div className={styles.calendarHeading}>Choose {datetime ? "date & time" : "date"}</div>
      <DayPicker autoFocus mode="single" selected={parse(value)} defaultMonth={parse(value) ?? min ?? max}
        captionLayout="dropdown" startMonth={min ?? new Date(1900, 0)} endMonth={max ?? new Date(2100, 11)}
        components={{ Select: FormSelect }} showOutsideDays
        disabled={[...(min ? [{ before: min }] : []), ...(max ? [{ after: max }] : [])]}
        onSelect={day => {
          if (!day) return;
          update(dateValue(day) + (datetime ? `T${value.split("T")[1] || "00:00"}` : ""));
          if (!datetime) finish();
        }} />
      {datetime && <label className={styles.time}>Time<input aria-label="Time" type="time" step={props.step}
        value={value.split("T")[1] ?? "00:00"}
        min={value.slice(0, 10) === String(props.min).slice(0, 10) ? String(props.min).split("T")[1] : undefined}
        max={value.slice(0, 10) === String(props.max).slice(0, 10) ? String(props.max).split("T")[1] : undefined}
        onChange={event => { if (event.target.value) update(`${value.slice(0, 10) || dateValue(new Date())}T${event.target.value}`); }} /></label>}
      <div className={styles.calendarFooter}>
        {!props.required && <button type="button" onClick={() => { update(""); finish(); }}>Clear</button>}
        <button type="button" onClick={finish}>Done</button>
      </div>
    </FieldPopover>}
  </>;
}
