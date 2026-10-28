import "server-only";
import sharp from "sharp";
import { createWorker, OEM, type Worker } from "tesseract.js";
import english from "@tesseract.js-data/eng";
import { parseReceiptText } from "@/lib/finance/references";
export async function extractReceipt(bytes: Buffer) {
  let worker: Worker | undefined, expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const task = (async () => {
    // External packages supply real filesystem paths. Bundled require.resolve calls
    // can become Turbopack module identifiers, which Node workers cannot open.
    worker = await createWorker("eng", OEM.LSTM_ONLY, {
      langPath: english.langPath, gzip: english.gzip, cacheMethod: "none", errorHandler: () => {} });
    if (expired) { await worker.terminate(); throw new Error("ocr-timeout"); }
    const png = await sharp(bytes, { limitInputPixels: 16_000_000 }).png().toBuffer();
    const { data } = await worker.recognize(png);
    const text = data.text.slice(0, 32000), confidence = Math.max(0, Math.min(100, data.confidence));
    return { text, confidence, ...parseReceiptText(text, confidence) };
  })();
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => { timeout = setTimeout(() => { expired = true; reject(new Error("ocr-timeout")); }, 45000); })]);
  } finally { expired = true; if (timeout) clearTimeout(timeout); await worker?.terminate(); }
}
