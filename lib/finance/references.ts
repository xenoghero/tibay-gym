/**
 * Any bank or e-wallet reference: letters and digits. Strip only spaces/dashes and
 * uppercase; keep leading zeros and never guess OCR character substitutions.
 */
export function normalizePaymentReference(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9 -]{4,80}$/.test(value.trim())) throw new Error("Enter the payment reference shown on the receipt.");
  const normalized = value.replace(/[ -]/g, "").toUpperCase();
  if (normalized.length < 4 || normalized.length > 64 || !/\d/.test(normalized)) throw new Error("Check the payment reference.");
  return normalized;
}

// First token must contain a digit; following tokens are digit groups (e.g. GCash "1234 567 891011").
const REFERENCE_VALUE = String.raw`[\s:#.-]*([A-Z0-9]*\d[A-Z0-9]*(?:[ -]\d+)*)`;
const REFERENCE_LABELS = [
  String.raw`\b(?:reference|ref)\b\.?\s*(?:no\b\.?|number\b|#)?`,
  String.raw`\b(?:transaction|trace|txn)\s*(?:id|no\b\.?|number)`,
];

/** Suggests a reference and amount from OCR text. A human still confirms both before approval. */
export function parseReceiptText(text: string, expectedAmountMinor?: number) {
  let reference: string | null = null;
  for (const label of REFERENCE_LABELS) {
    const match = new RegExp(label + REFERENCE_VALUE, "i").exec(text);
    try { reference = normalizePaymentReference(match?.[1]); break; } catch { /* Try the next label. */ }
  }
  const amounts = [...text.matchAll(/(?:amount|total|PHP|₱)[\s:PHP₱-]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi)]
    .map(match => Math.round(Number(match[1].replace(/,/g, "")) * 100)).filter(value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000);
  const unique = [...new Set(amounts)];
  // Currency signs often OCR as stray letters, so also accept the charged amount as any "700.00" on the receipt.
  const anywhere = [...text.matchAll(/(?<![\d.,])([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})(?![\d])/g)]
    .map(match => Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]));
  if (expectedAmountMinor !== undefined && anywhere.includes(expectedAmountMinor)) return { reference, amountMinor: expectedAmountMinor };
  // Receipts list fees and points too; the charged amount wins when it is present.
  const amountMinor = expectedAmountMinor !== undefined && unique.includes(expectedAmountMinor) ? expectedAmountMinor : unique.length === 1 ? unique[0] : null;
  return { reference, amountMinor };
}
