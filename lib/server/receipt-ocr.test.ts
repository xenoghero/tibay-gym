import { expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { extractReceipt } from "./receipt-ocr";
it("runs real Tesseract locally with bundled language data on synthetic evidence", async () => {
  const svg = '<svg width="1200" height="400"><rect width="100%" height="100%" fill="white"/><g font-family="Arial" font-size="48" fill="black"><text x="40" y="90">GCash payment</text><text x="40" y="190">Reference 0001234567890</text><text x="40" y="290">Amount PHP 60.00</text></g></svg>';
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  const result = await extractReceipt(image);
  expect(result.reference).toBe("0001234567890"); expect(result.amountMinor).toBe(6000);
  expect(result.text).toMatch(/GCash/i);
}, 60000);
