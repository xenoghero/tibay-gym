// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { PaymentDrawer } from "./payment-ui";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps the modal mounted through exit, then restores focus and scrolling", () => {
  vi.useFakeTimers();
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Review</button>{open && <PaymentDrawer title="Payment" onClose={() => setOpen(false)}>Details</PaymentDrawer>}</>;
  }
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Review" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Payment" }));
  fireEvent.click(screen.getByRole("button", { name: "Close payment details" }));
  expect(dialog.getAttribute("data-closing")).toBe("true");
  expect(screen.getByRole("dialog")).toBe(dialog);
  act(() => { vi.advanceTimersByTime(320); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe("");
});

it("animates Escape and completes once if the animation event is missed", () => {
  vi.useFakeTimers();
  const close = vi.fn();
  render(<PaymentDrawer title="Payment" onClose={close}>Details</PaymentDrawer>);
  const dialog = screen.getByRole("dialog");
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog.getAttribute("data-closing")).toBe("true");
  expect(close).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(320); });
  act(() => { vi.advanceTimersByTime(320); });
  expect(close).toHaveBeenCalledTimes(1);
});

it("prevents dismissal while a payment action is busy", () => {
  const close = vi.fn();
  render(<PaymentDrawer title="Payment" busy onClose={close}>Details</PaymentDrawer>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  fireEvent.click(screen.getByRole("button", { name: "Close payment details" }));
  expect(screen.getByRole("dialog").getAttribute("data-closing")).toBe("false");
  expect(close).not.toHaveBeenCalled();
});
