// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/auth-context", () => ({ useAuth: () => ({ user: stableUser }) }));
vi.mock("./receipt-retention", () => ({ ReceiptRetentionControls: () => null }));
const stableUser = { getIdToken: async () => "synthetic-token" };
import { ReceiptReview } from "./receipt-review";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("extracts only the opened receipt and fills the reference and amount without a queue worker", async () => {
  let extracted = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/image")) return new Response(null, { status: 404 });
    if (init?.method === "POST") { extracted = true; return Response.json({ status: "extracted" }); }
    return Response.json({ canExtract: true, receipt: { processed_at: extracted ? new Date().toISOString() : null, ocr_status: extracted ? "extracted" : "queued", extracted_reference: extracted ? "0001234567890" : null, extracted_amount_minor: extracted ? 6000 : null, confidence: extracted ? 95 : null, raw_text: null }, review: { reviewRevision: 0 }, referenceAlreadyClaimed: false, otherReceiptsUsingReference: 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptReview receiptId="receipt-1" expectedAmountMinor={6000} />); });
  expect(fetcher).toHaveBeenCalledWith("/api/receipts/review", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "extract", receiptId: "receipt-1" }) }));
  expect((screen.getByLabelText("GCash reference") as HTMLInputElement).value).toBe("0001234567890");
  expect((screen.getByLabelText("Reviewed amount (PHP)") as HTMLInputElement).value).toBe("60.00");
  expect(fetcher.mock.calls.some(([url]) => url.includes("/worker"))).toBe(false);
});
it("reuses a completed extraction on reopening and refreshing", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method ? Response.json({}, { status: 503 }) : url.includes("/image") ? new Response(null, { status: 404 }) : Response.json({
    canExtract: true, receipt: { ocr_status: "extracted", processed_at: "2026-10-28T01:00:00Z", extracted_reference: "0001234567890", extracted_amount_minor: 6000, confidence: 95, raw_text: null },
    review: { reviewRevision: 0 }, referenceAlreadyClaimed: false, otherReceiptsUsingReference: 0,
  }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptReview receiptId="receipt-1" expectedAmountMinor={6000} />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh receipt" })); });
  expect((screen.getByLabelText("GCash reference") as HTMLInputElement).value).toBe("0001234567890");
  expect(fetcher.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
});
it("preserves saved manual corrections instead of automatically scanning again", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method ? Response.json({}, { status: 503 }) : url.includes("/image") ? new Response(null, { status: 404 }) : Response.json({
    canExtract: true, receipt: { ocr_status: "queued", processed_at: null, extracted_reference: null, extracted_amount_minor: null, confidence: null, raw_text: null },
    review: { confirmedReference: "9991234567890", confirmedAmountMinor: 6500, reviewRevision: 3 }, referenceAlreadyClaimed: false, otherReceiptsUsingReference: 0,
  }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptReview receiptId="receipt-1" expectedAmountMinor={6500} />); });
  expect((screen.getByLabelText("GCash reference") as HTMLInputElement).value).toBe("9991234567890");
  expect((screen.getByLabelText("Reviewed amount (PHP)") as HTMLInputElement).value).toBe("65.00");
  expect(fetcher.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
});
it("keeps manual entry available when automatic extraction fails", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.includes("/image") ? new Response(null, { status: 404 }) : init?.method === "POST" ? Response.json({}, { status: 503 }) : Response.json({
    canExtract: true, receipt: { ocr_status: "queued", processed_at: null, extracted_reference: null, extracted_amount_minor: null, confidence: null, raw_text: null },
    review: { reviewRevision: 0 }, referenceAlreadyClaimed: false, otherReceiptsUsingReference: 0,
  }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => { render(<ReceiptReview receiptId="receipt-1" expectedAmountMinor={6000} />); });
  expect(screen.getByText(/Could not scan this receipt/)).toBeTruthy();
  expect((screen.getByLabelText("GCash reference") as HTMLInputElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("GCash reference"), { target: { value: "0001234567890" } });
  expect((screen.getByLabelText("GCash reference") as HTMLInputElement).value).toBe("0001234567890");
});
