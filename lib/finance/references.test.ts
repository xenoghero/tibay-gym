import { expect, it } from "vitest";
import { normalizePaymentReference, parseReceiptText } from "./references";
it("normalizes formatting without stripping leading zeros or guessing OCR letters", () => {
  expect(normalizePaymentReference(" 0001-2345 67890 ")).toBe("0001234567890");
  expect(normalizePaymentReference("ito261110060130002")).toBe("ITO261110060130002");
  expect(() => normalizePaymentReference("123")).toThrow();
  expect(() => normalizePaymentReference("ABCDEFG")).toThrow();
});
it("reads GCash receipts", () => {
  expect(parseReceiptText("GCash\nRef No. 0001 234 567890 Nov 10, 2026\nAmount PHP 60.00")).toEqual({ reference: "0001234567890", amountMinor: 6000 });
});
it("reads other bank receipts (MariBank, GoTyme)", () => {
  expect(parseReceiptText("PHP 700.00\nTransfer Amount PHP 700.00\nReference Number 103052\nTransfer Method instaPay\nRA728772 referral code", 70000))
    .toEqual({ reference: "103052", amountMinor: 70000 });
  expect(parseReceiptText("Transferred\n₱700.00\nAmount ₱700.00\nFee ₱9.00\nPaid with points -₱9.00\nTotal ₱700.00\nTrace ID 130002\nReference No. ITO261110060130002", 70000))
    .toEqual({ reference: "ITO261110060130002", amountMinor: 70000 });
});
it("finds the charged amount when the currency sign is misread", () => {
  expect(parseReceiptText("Amount\n®700.00\nFee\n®9.00\nTotal\nB700.00", 70000).amountMinor).toBe(70000);
  expect(parseReceiptText("Amount\n®1,200.00", 70000).amountMinor).toBeNull();
});
it("leaves ambiguous amounts and unreadable evidence for the admin", () => {
  expect(parseReceiptText("Reference 0001234567890\nAmount 60.00\nTotal 70.00").amountMinor).toBeNull();
  expect(parseReceiptText("Unreadable image")).toEqual({ reference: null, amountMinor: null });
});
