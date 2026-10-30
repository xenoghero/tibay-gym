// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentMethodSelect } from "./payment-method-select";
import type { PaymentAccount } from "@/lib/finance/payment-methods";

afterEach(cleanup);
const accounts: PaymentAccount[] = [
  { id: "account_bank0001", kind: "bank" as const, name: "BDO", accountHolder: "Gym", accountNumber: "00123", qrImage: null, enabled: true },
];

it("supports keyboard selection, Escape and dismissal outside the menu", () => {
  const change = vi.fn();
  render(<PaymentMethodSelect value="cash" accounts={accounts} available onChange={change} />);
  const trigger = screen.getByRole("combobox", { name: "Payment method" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "End" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /BDO/ }).id);
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("account_bank0001");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("prevents choosing unavailable electronic methods with a pointer or keyboard", () => {
  const change = vi.fn();
  render(<PaymentMethodSelect value="cash" accounts={accounts} available={false} onChange={change} />);
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: /BDO/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "End" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("cash");
});
