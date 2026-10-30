/** Keep leading zeros. Strip only harmless formatting; never guess OCR substitutions. */
export function normalizeGcashReference(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9\s-]{8,80}$/.test(value)) throw new Error("Enter the numeric GCash reference shown on the receipt.");
  const normalized = value.replace(/[\s-]/g, "");
  if (!/^\d{8,32}$/.test(normalized)) throw new Error("Check the GCash reference digits.");
  return normalized;
}
export function parseReceiptText(text: string, confidence: number) {
  const referenceMatch = /\b(?:reference|ref\.?)(?:\s*(?:no\.?|number))?[\s:#-]*([0-9][0-9 -]{7,40})/i.exec(text);
  let reference: string | null = null;
  try { reference = normalizeGcashReference(referenceMatch?.[1]?.trim()); } catch { /* Human review is required. */ }
  const amounts = [...text.matchAll(/(?:amount(?:\s+(?:paid|sent|received))?|total(?:\s+amount)?|PHP|₱)[\s:PHP₱]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi)]
    .map(match => Math.round(Number(match[1].replace(/,/g, "")) * 100)).filter(value => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000);
  const unique = [...new Set(amounts)], amountMinor = unique.length === 1 ? unique[0] : null;
  return { reference, amountMinor, status: reference && amountMinor !== null && confidence >= 70 ? "extracted" as const : "needs_review" as const };
}

export function normalizePaymentReference(value: unknown, account?: { kind: string } | null) {
  if (!account || account.kind === "gcash") return normalizeGcashReference(value);
  if (typeof value !== "string" || !/^[A-Za-z0-9 -]{4,80}$/.test(value)) throw new Error("Enter the payment reference shown on the receipt.");
  const normalized = value.replace(/[ -]/g, "").toUpperCase();
  if (normalized.length < 4 || normalized.length > 64) throw new Error("Check the payment reference.");
  return normalized;
}
