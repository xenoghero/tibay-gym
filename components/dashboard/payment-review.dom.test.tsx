// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: stableUser }) }));
vi.mock("./receipt-review", async () => {
  const { ReceiptRetentionControls } = await import("./receipt-retention");
  return { ReceiptReview: ({ receiptId }: { receiptId: string }) => <ReceiptRetentionControls receiptId={receiptId} /> };
});
vi.mock("./daily-payments", () => ({ DailyPayments: () => <p>Daily charge list</p> }));
const stableUser = { getIdToken: async () => "synthetic-token" };
import { PaymentReview } from "./payment-review";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not claim an empty queue while loading and clears stale errors on refresh", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending).mockResolvedValue(Response.json({ records: [], nextCursor: null })));
  await act(async () => { render(<PaymentReview />); });
  expect(screen.getByText("Loading payment requests…")).toBeTruthy(); expect(screen.queryByText("No requests on this page.")).toBeNull();
  await act(async () => { finish(Response.json({}, { status: 503 })); });
  expect(screen.getByText(/Could not load payment/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh requests" })); });
  expect(screen.queryByText(/Could not load payment/)).toBeNull(); expect(screen.getByText("No requests on this page.")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Daily payments$/ })); });
  expect(screen.getByRole("button", { name: /^Daily payments$/ }).getAttribute("aria-pressed")).toBe("true");
});
it("offers local receipt/photo cleanup and hold controls for a deleted customer's payment", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    if (url.startsWith("/api/finance/review")) return Response.json({ records: [{ payment: { id: "pay1", personId: "deleted", receiptId: "r1", status: "approved", amountMinor: 60000, submittedAt: Date.now() }, charge: { kind: "renewal" }, customer: { name: "Deleted customer" } }], nextCursor: null });
    if (url.startsWith("/api/receipts/retention")) return Response.json({ paymentStatus: "approved", policy: { revision: 0, disputeHold: false, legalHold: false } });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<PaymentReview />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review payment for Deleted customer" })); });
  fireEvent.click(screen.getByText("Receipt retention and holds"));
  expect(screen.getByText(/Accounting protection is active/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close payment details" }));
  fireEvent.click(screen.getByText("Maintenance"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run retention cleanup" })); });
  for (const endpoint of ["/api/receipts/worker", "/api/images/cleanup"])
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer synthetic-token" } }));
  expect(screen.getByText(/Retention maintenance finished/)).toBeTruthy();
});

it("filters the loaded queue by customer, reference, status and method", async () => {
  const { chargeFixture, paymentFixture } = await import("@/tests/finance-fixtures");
  const charge = chargeFixture("renewal", { kind: "renewal" });
  const records = [
    { charge, payment: paymentFixture("a", charge, { method: "gcash" }), customer: { id: "a", name: "Renier Luna" }, gcashReference: "GC-123" },
    { charge, payment: paymentFixture("b", charge, { status: "approved" }), customer: { id: "b", name: "Ana Santos" } },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ records, nextCursor: null })));
  await act(async () => { render(<PaymentReview />); });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "gc-123" } });
  expect(screen.getByRole("button", { name: "Review payment for Renier Luna" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review payment for Ana Santos" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Status", { exact: true }), { target: { value: "approved" } });
  expect(screen.queryByRole("button", { name: "Review payment for Renier Luna" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Method", { exact: true }), { target: { value: "gcash" } });
  expect(screen.getByText("No matching requests")).toBeTruthy();
});
it("requires review and changed-coverage acknowledgement before approval and preserves the decision payload", async () => {
  const { chargeFixture, paymentFixture } = await import("@/tests/finance-fixtures");
  const charge = chargeFixture("renewal", { kind: "renewal" });
  const payment = paymentFixture("a", charge);
  const row = { charge, payment, customer: { id: "a", name: "Renier Luna" } };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ ok: true }) : url.includes("?id=") ? Response.json({ ...row, previewToken: "current-preview", membershipChanged: true, coverage: { startDate: "2026-10-28", expiryDate: "2026-11-28", months: 1 } }) : Response.json({ records: [row], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<PaymentReview />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review payment for Renier Luna" })); });
  const approve = screen.getByRole("button", { name: "Approve — payment received" });
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("I reviewed the amount, evidence and final coverage."));
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/Membership changed since submission/));
  expect((approve as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { fireEvent.click(approve); });
  expect(fetcher).toHaveBeenCalledWith("/api/finance/review", expect.objectContaining({ method: "POST", body: JSON.stringify({ paymentRequestId: "a", decision: "approve", reviewed: true, reason: "", previewToken: "current-preview", acknowledgeMembershipChange: true }) }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
