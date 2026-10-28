import { expect, it } from "vitest";
import { normalizeGcashReference, parseReceiptText } from "./references";
it("normalizes formatting without stripping leading zeros or guessing OCR letters", () => {
  expect(normalizeGcashReference(" 0001-2345 67890 ")).toBe("0001234567890");
  expect(() => normalizeGcashReference("OOO1234567890")).toThrow();
  expect(() => normalizeGcashReference("123")).toThrow();
});
it("extracts labelled reference and amount but never a payment decision", () => {
  expect(parseReceiptText("GCash\nReference No. 0001234567890\nAmount PHP 60.00", 90)).toEqual({ reference: "0001234567890", amountMinor: 6000, status: "extracted" });
});
it("sends ambiguous amounts, unreadable evidence and low confidence to human review", () => {
  expect(parseReceiptText("Reference 0001234567890\nAmount 60.00\nTotal 70.00", 90)).toMatchObject({ amountMinor: null, status: "needs_review" });
  expect(parseReceiptText("Unreadable image", 90).status).toBe("needs_review");
  expect(parseReceiptText("Reference 0001234567890\nAmount 60.00", 45).status).toBe("needs_review");
});
