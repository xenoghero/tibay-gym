// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const authMock = vi.hoisted(() => ({ user: { getIdToken: async () => "synthetic-token" } }));
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => authMock }));
import { PurchaseForm } from "./purchase-form";
const plain = { kind: "renewal", amountMinor: 100000, categorySnapshot: "student", rateRevision: 1, quoteToken: "plain", coverage: { startDate: "2026-10-29", expiryDate: "2026-11-29", months: 1 }, gcashAvailable: true };
const discounted = { ...plain, quoteToken: "discounted", amountMinor: 90000, baseAmountMinor: 100000, discountAmountMinor: 10000,
  voucherSnapshot: { id: "v1", code: "TRAIN10", revision: 1, discountKind: "percent", value: 1000, maxDiscountMinor: null } };
const posts: Record<string, unknown>[] = [];
beforeEach(() => { posts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ id: "purchase-1" }); }
    if (url.includes("BADCODE")) return Response.json({ error: "voucher-scope" }, { status: 409 });
    return Response.json(url.includes("voucherCode=") ? discounted : plain);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("uploads a bank renewal receipt with the selected account and settings revision", async () => {
  const account = { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678", qrImage: null, enabled: true };
  let uploadHeaders: Headers | null = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/receipts/upload") { uploadHeaders = new Headers(init?.headers); return Response.json({ receiptId: "receipt-bank", receiptToken: "proof-bank" }); }
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ id: "purchase-bank" }); }
    return Response.json({ ...plain, paymentRevision: 3, paymentAccounts: [account] });
  }));
  await act(async () => { render(<PurchaseForm portal />); });
  fireEvent.click(screen.getByRole("combobox", { name: "Payment method" }));
  fireEvent.click(screen.getByRole("option", { name: /BPI savings/ }));
  expect(screen.getByText(account.accountNumber)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Payment receipt"), { target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Submit payment request/ }).closest("form")!); });
  expect(uploadHeaders!.get("x-payment-method")).toBe(account.id);
  expect(uploadHeaders!.get("x-payment-revision")).toBe("3");
  expect(posts[0]).toMatchObject({ method: account.id, paymentRevision: 3, receiptId: "receipt-bank", receiptToken: "proof-bank" });
});
async function apply(code: string) {
  const summary = screen.getByText(/Have a voucher|Use a different voucher/).closest("details")!;
  if (!summary.open) fireEvent.click(summary.querySelector("summary")!);
  fireEvent.change(screen.getByLabelText("Voucher code"), { target: { value: code } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply" })); });
}
it("shows discount math and submits the applied server quote, without client-calculated totals", async () => {
  await act(async () => { render(<PurchaseForm portal />); });
  await apply("TRAIN10");
  expect(screen.getByText("Voucher TRAIN10")).toBeTruthy(); expect(screen.getByText("−₱100.00")).toBeTruthy();
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Submit payment request/ }).closest("form")!); });
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ voucherCode: "TRAIN10", quoteToken: "discounted", method: "cash" });
  expect(posts[0].amountMinor).toBeUndefined();
});
it("keeps an applied quote intact on an invalid replacement, and removes it explicitly", async () => {
  await act(async () => { render(<PurchaseForm portal />); }); await apply("TRAIN10"); await apply("BADCODE");
  expect(screen.getByText(/does not apply to this purchase/)).toBeTruthy(); expect(screen.getByText("Voucher TRAIN10")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
  expect(screen.queryByText("Voucher TRAIN10")).toBeNull();
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Submit payment request/ }).closest("form")!); });
  expect(posts[0].voucherCode).toBeUndefined(); expect(posts[0].quoteToken).toBe("plain");
});
it("locks the existing discount on rejected-payment corrections", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json(discounted));
  await act(async () => { render(<PurchaseForm portal previousRequestId="rejected-1" />); });
  expect(screen.queryByLabelText("Voucher code")).toBeNull(); expect(screen.getByText("Voucher TRAIN10")).toBeTruthy();
});
it("clears selected receipt evidence when the payable quote changes", async () => {
  await act(async () => { render(<PurchaseForm portal />); });
  fireEvent.click(screen.getByRole("combobox", { name: "Payment method" }));
  fireEvent.click(screen.getByRole("option", { name: /GCash/ }));
  const input = screen.getByLabelText("GCash receipt") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["receipt"], "receipt.png", { type: "image/png" })] } });
  await apply("TRAIN10");
  // The state must also be cleared: submitting an old selection cannot upload a proof for the new price.
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /Submit payment request/ }).closest("form")!); });
  expect(posts).toHaveLength(0); expect(screen.getByText(/Choose a JPG, PNG or WebP receipt/)).toBeTruthy();
});
