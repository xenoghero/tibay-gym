"use client";

import type { ComponentProps } from "react";
import { DateInput } from "./date-input";

const pickerTypes = new Set(["time"]);

function openPicker(input: HTMLInputElement) {
  if (!pickerTypes.has(input.type) || input.matches(":disabled") || input.readOnly || !input.showPicker) return false;
  try {
    input.showPicker();
    return true;
  } catch {
    // Unsupported picker types and embedded browsers retain native editing.
    return false;
  }
}

/** Native form values and validation, with the shared calendar for date fields. */
export function FormInput({ type = "text", inputMode, onClick, onKeyDown, ...props }: ComponentProps<"input">) {
  if (type === "date" || type === "datetime-local") return <DateInput {...props} type={type} inputMode={inputMode} onClick={onClick} onKeyDown={onKeyDown} />;
  return <input {...props} type={type} data-form-input
    inputMode={inputMode ?? (type === "number" ? "numeric" : type === "tel" ? "tel" : undefined)}
    onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented) openPicker(event.currentTarget);
    }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (!event.defaultPrevented && event.altKey && event.key === "ArrowDown" && openPicker(event.currentTarget)) event.preventDefault();
    }} />;
}
