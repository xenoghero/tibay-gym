// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PaymentAccount } from "@/lib/finance/payment-methods";
import { PaymentAccountDetails } from "./payment-account-details";

afterEach(cleanup);
const account: PaymentAccount = { id: "account_gcash001", kind: "gcash", name: "GCash", accountHolder: "Tibay Gym", accountNumber: "09171234567", qrImage: "data:image/png;base64,b3JpZ2luYWw=", enabled: true };

it("uses GCash branding while displaying and downloading the current admin QR", () => {
  const { rerender } = render(<PaymentAccountDetails account={account} />);
  expect(screen.getByRole("img", { name: "GCash" }).getAttribute("src")).toBe("/images/payments/gcash-wordmark.png");
  expect(screen.getByRole("img", { name: "GCash payment QR code" }).getAttribute("src")).toBe(account.qrImage);
  expect(screen.getByRole("link", { name: "Save QR image" }).getAttribute("href")).toBe(account.qrImage);
  expect(screen.getByText(account.accountHolder)).toBeTruthy();
  expect(screen.getByText(account.accountNumber)).toBeTruthy();
  const replacement = { ...account, accountHolder: "Updated Gym", qrImage: "data:image/png;base64,cmVwbGFjZW1lbnQ=" };
  rerender(<PaymentAccountDetails account={replacement} />);
  expect(screen.getByRole("img", { name: "GCash payment QR code" }).getAttribute("src")).toBe(replacement.qrImage);
  expect(screen.getByRole("link", { name: "Save QR image" }).getAttribute("href")).toBe(replacement.qrImage);
  expect(screen.getByText("Updated Gym")).toBeTruthy();
});

it("offers the receiving number without a fake QR or download when none is configured", () => {
  render(<PaymentAccountDetails account={{ ...account, qrImage: null }} />);
  expect(screen.queryByRole("img", { name: "GCash payment QR code" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Save QR image" })).toBeNull();
  expect(screen.getByText(account.accountNumber)).toBeTruthy();
  expect(screen.getByText("No payment QR available.")).toBeTruthy();
});
