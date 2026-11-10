// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./receipt-retention", () => ({ ReceiptRetentionControls: () => null }));
vi.mock("./receipt-image", () => ({ ReceiptImage: ({ onImage }: { onImage?: (blob: Blob) => void }) => <button onClick={() => onImage?.(new Blob(["x"]))}>load image</button> }));
const ocr = vi.hoisted(() => ({ result: { reference: "ITO261110060130002" as string | null, amountMinor: 70000 as number | null } }));
vi.mock("@/lib/receipt-ocr", () => ({ readReceipt: async () => ocr.result }));
import { ReceiptReview } from "./receipt-review";
afterEach(cleanup);
function Harness() {
  const [reference, setReference] = useState("");
  return <ReceiptReview receiptId="r1" expectedAmountMinor={70000} reference={reference} onReference={setReference} />;
}
it("reads the receipt in the browser and pre-fills the reference", async () => {
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText("load image")); });
  expect((screen.getByLabelText(/Payment reference/) as HTMLInputElement).value).toBe("ITO261110060130002");
  expect((screen.getByLabelText(/Amount on receipt/) as HTMLInputElement).value).toBe("700.00");
  expect(screen.getByText(/amount matches/)).toBeTruthy();
});
it("shows a skeleton until the receipt is read, then flags an unexpected amount", async () => {
  ocr.result = { reference: "103052", amountMinor: 50000 };
  render(<Harness />);
  expect(screen.queryByLabelText(/Payment reference/)).toBeNull();
  expect(screen.getByText("Reading the receipt…")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText("load image")); });
  expect((screen.getByLabelText(/Payment reference/) as HTMLInputElement).value).toBe("103052");
  expect((screen.getByLabelText(/Amount on receipt/) as HTMLInputElement).value).toBe("500.00");
  expect(screen.getByRole("alert").textContent).toContain("differs from the expected PHP 700.00");
});
