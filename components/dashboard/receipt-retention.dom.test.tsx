// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_RECEIPT_RETENTION } from "@/lib/receipt-retention";
const user = { getIdToken: async () => "synthetic-token" };
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user }) }));
import { ReceiptRetentionControls } from "./receipt-retention";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("loads approved accounting protection and saves an authenticated dispute hold", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ policy: DEFAULT_RECEIPT_RETENTION, paymentStatus: "approved" }))
    .mockResolvedValueOnce(Response.json({ revision: 1 }))
    .mockResolvedValueOnce(Response.json({ policy: { ...DEFAULT_RECEIPT_RETENTION, revision: 2, disputeHold: true, legalHold: true }, paymentStatus: "approved" }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptRetentionControls receiptId="r1" />); });
  expect(screen.getByText(/Accounting protection is active/)).toBeTruthy();
  fireEvent.click(screen.getByText("Receipt retention and holds"));
  fireEvent.click(screen.getByLabelText("Keep evidence for an open dispute"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save retention and holds" })); });
  const options = fetcher.mock.calls[1][1];
  expect(options.headers.Authorization).toBe("Bearer synthetic-token");
  expect(JSON.parse(options.body)).toMatchObject({ receiptId: "r1", disputeHold: true, legalHold: false, filingDeadline: null, filedAt: null, expectedRevision: 0 });
  expect(screen.getByText("Receipt retention saved.")).toBeTruthy();
  expect((screen.getByLabelText("Keep evidence for a legal or accounting hold") as HTMLInputElement).checked).toBe(true);
});
it("requires both filing dates and explains that removal already in progress cannot be held", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ policy: DEFAULT_RECEIPT_RETENTION, paymentStatus: "approved" }))
    .mockResolvedValueOnce(Response.json({ policy: { ...DEFAULT_RECEIPT_RETENTION, purgeState: "purging" }, paymentStatus: "approved" }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptRetentionControls receiptId="r1" />); });
  fireEvent.click(screen.getByText("Receipt retention and holds"));
  fireEvent.change(screen.getByLabelText("Return filing deadline"), { target: { value: "2027-04-15" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save retention and holds" })); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Enter both filing dates/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh retention" })); });
  expect(screen.getByText(/Holds can no longer be changed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save retention and holds" })).toBeNull();
});
