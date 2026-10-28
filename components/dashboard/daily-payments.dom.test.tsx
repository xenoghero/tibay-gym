// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: stableUser }) }));
vi.mock("./receipt-review", () => ({ ReceiptReview: () => null }));
const stableUser = { getIdToken: async () => "synthetic-token" };
import { DailyPayments } from "./daily-payments";
import { chargeFixture } from "@/tests/finance-fixtures";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("uses linked method/status rather than guessing cash from a request ID", async () => {
  const charges = [
    { ...chargeFixture("replacement"), activePaymentRequestId: "pay-new-id", paymentMethod: "cash", paymentStatus: "pending" },
    { ...chargeFixture("rejected"), activePaymentRequestId: "rejected-cash", paymentMethod: "cash", paymentStatus: "rejected" },
    { ...chargeFixture("scanner"), activePaymentRequestId: null },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ charges, nextCursor: null })));
  await act(async () => { render(<DailyPayments />); });
  expect(screen.getByText(/cash — review the linked request below/)).toBeTruthy();
  expect(screen.getByText("Rejected — linked replacement required")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Review cash received" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Review GCash receipt" })).toBeNull();
});

it("requires a checked cash amount and sends the expected charge when confirming", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const charge = { ...chargeFixture("cash"), customerName: "Renier Luna" };
  const onConfirmed = vi.fn();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === "POST" ? { ok: true } : { charges: [charge], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<DailyPayments onConfirmed={onConfirmed} />); });
  fireEvent.click(screen.getByRole("button", { name: "Review cash received" }));
  const confirm = screen.getByRole("button", { name: "Confirm cash received" });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("I received and checked this cash amount."));
  await act(async () => { fireEvent.click(confirm); });
  expect(fetcher).toHaveBeenCalledWith("/api/finance/daily", expect.objectContaining({ method: "POST", body: JSON.stringify({ chargeId: "cash", expectedAmountMinor: 6000, reviewed: true }) }));
  expect(onConfirmed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
