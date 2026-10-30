"use client";

import type { ComponentProps } from "react";

const pickerTypes = new Set(["date", "datetime-local", "time"]);

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

/** Keeps native values, validation, labels and refs; the entire date field opens its picker. */
export function FormInput({ type = "text", inputMode, onClick, onKeyDown, ...props }: ComponentProps<"input">) {
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
