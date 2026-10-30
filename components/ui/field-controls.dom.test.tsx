// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { FormInput } from "./form-input";
import { FormSelect } from "./form-select";

afterEach(cleanup);

it.each(["date", "datetime-local"])("opens the shared %s calendar with Alt+Down and restores focus on Escape", type => {
  render(<label>Date<FormInput type={type} /></label>);
  const input = screen.getByLabelText("Date");
  fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
  const popup = screen.getByRole("dialog", { name: "Choose date" });
  fireEvent.keyDown(popup, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(input);
});

it("selects a date through the calendar and preserves native form data and change handlers", () => {
  const change = vi.fn();
  function Form() {
    const [date, setDate] = useState("2026-10-15");
    return <form aria-label="Dates"><label>Date<FormInput name="date" type="date" min="2026-10-10" max="2026-10-20"
      value={date} onChange={event => { change(event.target.value); setDate(event.target.value); }} /></label></form>;
  }
  render(<Form />);
  fireEvent.click(screen.getByLabelText("Date"));
  const calendar = screen.getByRole("dialog", { name: "Choose date" });
  expect(within(calendar).getByRole("button", { name: /October 9th, 2026/ }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(calendar).getByRole("button", { name: /October 19th, 2026/ }));
  expect(change).toHaveBeenCalledWith("2026-10-19");
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("date")).toBe("2026-10-19");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText("Date"));
});

it("uses the shared dropdown for month navigation without dismissing the calendar", () => {
  render(<label>Date<FormInput type="date" defaultValue="2026-10-15" /></label>);
  fireEvent.click(screen.getByLabelText("Date"));
  const month = screen.getByRole("combobox", { name: /month/i });
  fireEvent.keyDown(month, { key: "ArrowDown" });
  fireEvent.keyDown(month, { key: "Home" });
  fireEvent.keyDown(month, { key: "Enter" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect((screen.getByRole("combobox", { name: /month/i }) as HTMLSelectElement).value).toBe("0");
});

it("keeps calendar and option popups inside a containing modal dialog", () => {
  render(<dialog open aria-label="Date filters"><label>Date<FormInput type="date" defaultValue="2026-10-15" /></label></dialog>);
  const sheet = screen.getByRole("dialog", { name: "Date filters" });
  fireEvent.click(screen.getByLabelText("Date"));
  const calendar = screen.getByRole("dialog", { name: "Choose date" });
  expect(calendar.closest("dialog")).toBe(sheet);
  fireEvent.keyDown(screen.getByRole("combobox", { name: /month/i }), { key: "ArrowDown" });
  expect(screen.getByRole("listbox").closest("dialog")).toBe(sheet);
  fireEvent.keyDown(screen.getByRole("combobox", { name: /month/i }), { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Choose date" })).toBe(calendar);
});

it("keeps the time when changing the day of a datetime field", () => {
  const change = vi.fn();
  render(<label>Starts<FormInput type="datetime-local" defaultValue="2026-10-15T14:30" onChange={event => change(event.target.value)} /></label>);
  fireEvent.click(screen.getByLabelText("Starts"));
  fireEvent.click(screen.getByRole("button", { name: /October 19th, 2026/ }));
  expect(change).toHaveBeenCalledWith("2026-10-19T14:30");
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "16:45" } });
  expect(change).toHaveBeenLastCalledWith("2026-10-19T16:45");
});

it("supports dropdown keyboard selection, skips disabled options, and submits the value", () => {
  const change = vi.fn();
  render(<form aria-label="Payment"><label>Method<FormSelect name="method" defaultValue="cash" onChange={event => change(event.target.value)}>
    <option value="cash">Cash</option><option value="unavailable" disabled>Unavailable</option><option value="bank">Bank</option>
  </FormSelect></label></form>);
  const select = screen.getByRole("combobox", { name: "Method" });
  fireEvent.keyDown(select, { key: "ArrowDown" });
  fireEvent.keyDown(select, { key: "ArrowDown" });
  expect(select.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Bank" }).id);
  fireEvent.keyDown(select, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("bank");
  expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("method")).toBe("bank");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(select);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});
