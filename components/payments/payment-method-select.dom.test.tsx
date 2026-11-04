// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentMethodSelect } from "./payment-method-select";
import type { PaymentAccount } from "@/lib/finance/payment-methods";

afterEach(cleanup);
const accounts: PaymentAccount[] = [
  { id: "account_bank0001", kind: "gcash" as const, name: "GCash", accountHolder: "Gym", accountNumber: "00123", qrImage: null, enabled: true },
];

it("supports keyboard selection, Escape and dismissal outside the menu", () => {
  const change = vi.fn();
  render(<PaymentMethodSelect value="cash" accounts={accounts} available onChange={change} />);
  const trigger = screen.getByRole("combobox", { name: "Payment method" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "End" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /GCash/ }).id);
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
  fireEvent.click(screen.getByRole("option", { name: /GCash/ }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: "End" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("cash");
});

it("shows only Cash and one GCash choice when old settings contain other methods", () => {
  render(<PaymentMethodSelect value="cash" accounts={[
    { ...accounts[0], id: "account_oldbank1", kind: "bank", name: "Old bank" },
    ...accounts,
    { ...accounts[0], id: "account_wallet02", name: "Second wallet" },
  ]} available onChange={() => {}} />);
  fireEvent.click(screen.getByRole("combobox"));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getByRole("option", { name: /GCash/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Old bank|Second wallet/ })).toBeNull();
});
