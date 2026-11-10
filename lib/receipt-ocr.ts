import { parseReceiptText } from "@/lib/finance/references";

/**
 * Reads a receipt in the admin's browser. Tesseract's worker, core and English data load
 * from the jsDelivr CDN and are cached by the browser, so the server does no OCR work.
 */
export async function readReceipt(image: Blob, expectedAmountMinor?: number) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(image);
    return parseReceiptText(data.text, expectedAmountMinor);
  } finally { await worker.terminate(); }
}
