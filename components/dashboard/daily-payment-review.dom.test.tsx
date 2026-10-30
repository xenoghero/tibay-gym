// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chargeFixture, paymentFixture } from "@/tests/finance-fixtures";
import { PaymentReview } from "./payment-review";

const stableUser = { getIdToken: async () => "synthetic-token" };
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: stableUser }) }));
vi.mock("./receipt-review", () => ({ ReceiptReview: ({ receiptId }: { receiptId: string }) => <p>Receipt {receiptId}</p> }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows one table and retains a deleted customer's rejected and replacement payment history", async () => {
  const charge = chargeFixture("visit", { confirmedPaymentRequestId: "replacement" });
  const payments = [
    paymentFixture("replacement", charge, { status: "approved", previousRequestId: "original", receiptId: "receipt-new" }),
    paymentFixture("original", charge, { status: "rejected", rejectionReason: "Incorrect receipt", receiptId: "receipt-old" }),
  ];
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes("chargeId=") ? { payments } : url.startsWith("/api/finance/daily") ? { charges: [{ ...charge, customerName: "Deleted customer", paymentMethod: "gcash", paymentStatus: "approved" }], nextCursor: null } : { records: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<PaymentReview />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Daily payments" })); });
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getAllByText("Deleted customer")).toHaveLength(1);
  expect(screen.queryByText("Daily payment requests")).toBeNull();
  expect(screen.queryByText("Daily collections")).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url.includes("kind=daily_session"))).toBe(false);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View details" })); });
  const drawer = within(screen.getByRole("dialog"));
  expect(drawer.getByRole("region", { name: "Payment history" })).toBeTruthy();
  expect(drawer.getByText("Rejection reason: Incorrect receipt")).toBeTruthy();
  expect(drawer.getAllByText("original", { selector: "dd" })).toHaveLength(2);
  expect(drawer.getByText("Receipt receipt-old")).toBeTruthy();
  expect(drawer.getByText("Receipt receipt-new")).toBeTruthy();
  expect(drawer.queryByRole("button", { name: "Confirm cash received" })).toBeNull();
});

it("reviews a pending GCash payment from the single row and refreshes it to collected", async () => {
  const charge = chargeFixture("visit", { activePaymentRequestId: "payment" });
  const payment = paymentFixture("payment", charge, { method: "gcash", receiptId: "proof" });
  let approved = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { approved = true; return Response.json({ ok: true }); }
    if (url.includes("chargeId=")) return Response.json({ payments: [payment] });
    if (url.includes("?id=")) return Response.json({ payment, charge, customer: { name: "Ana Santos" }, coverage: null, previewToken: "preview", membershipChanged: false });
    if (url.startsWith("/api/finance/daily")) return Response.json({ charges: [{ ...charge, customerName: "Ana Santos", paymentMethod: "gcash", paymentStatus: approved ? "approved" : "pending", confirmedPaymentRequestId: approved ? payment.id : null, gcashReference: "GC-123" }], nextCursor: null });
    return Response.json({ records: [], nextCursor: null });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<PaymentReview />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Daily payments" })); });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "GC-123" } });
  expect(screen.getByText("Ana Santos")).toBeTruthy();
  fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
  fireEvent.click(screen.getByRole("option", { name: "Awaiting payment" }));
  expect(screen.queryByText("Ana Santos")).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
  fireEvent.click(screen.getByRole("option", { name: "Pending review" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review payment" })); });
  expect(screen.getAllByText("Receipt proof")).toHaveLength(1);
  fireEvent.click(screen.getByLabelText("I reviewed the amount, evidence and final coverage."));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve — payment received" })); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Ana Santos")).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
  fireEvent.click(screen.getByRole("option", { name: "Collected" }));
  expect(within(screen.getByRole("table")).getByText("Collected")).toBeTruthy();
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "View details" })).toBeTruthy();
});
