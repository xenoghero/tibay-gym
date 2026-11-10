"use client";

import { useRef, useState } from "react";
import type { PaymentAccountSnapshot } from "@/lib/finance/payment-methods";
import { parsePesoInput } from "@/lib/finance/rules";
import { readReceipt } from "@/lib/receipt-ocr";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import styles from "./payment-review.module.css";
import { ReceiptRetentionControls } from "./receipt-retention";
import { ReceiptImage } from "./receipt-image";

/**
 * Shows the private receipt. When `onReference` is given (a pending approval), the browser
 * reads the receipt and pre-fills its reference; the admin confirms it while approving.
 */
export function ReceiptReview({ receiptId, expectedAmountMinor, paymentAccount, reference = "", onReference }: {
  receiptId: string; expectedAmountMinor: number; paymentAccount?: PaymentAccountSnapshot | null;
  reference?: string; onReference?: (value: string) => void;
}) {
  const [scan, setScan] = useState<"idle" | "scanning" | "done" | "failed">("idle");
  const [amount, setAmount] = useState(""), [hasImage, setHasImage] = useState(false);
  const image = useRef<Blob | null>(null), typed = useRef(false);
  async function scanReceipt() {
    if (!image.current || !onReference) return;
    setScan("scanning");
    try {
      const result = await readReceipt(image.current, expectedAmountMinor);
      if (result.amountMinor !== null) setAmount((result.amountMinor / 100).toFixed(2));
      if (result.reference && !typed.current) onReference(result.reference);
      setScan("done");
    } catch { setScan("failed"); }
  }
  let amountMinor: number | null = null;
  try { amountMinor = parsePesoInput(amount); } catch { /* Shown as a mismatch below. */ }
  const expected = `PHP ${(expectedAmountMinor / 100).toFixed(2)}`;
  return <section className={styles.receipt}><h3>Receipt</h3>
    <ReceiptImage key={`image-${receiptId}`} receiptId={receiptId} alt={paymentAccount ? `Private ${paymentAccount.name} receipt` : "Private payment receipt"}
      onImage={blob => { image.current = blob; setHasImage(!!blob); if (blob) void scanReceipt(); else setScan("failed"); }} />
    {onReference && (scan === "idle" || scan === "scanning") && <LoadingSkeleton label="Reading the receipt…" variant="form" count={2} />}
    {onReference && scan !== "idle" && scan !== "scanning" && <div style={{ display: "grid", gap: 8 }}>
      {scan === "failed" && <p role="alert">The receipt could not be read. Type the reference from the image.</p>}
      {amountMinor === expectedAmountMinor && <p role="status">Receipt amount matches the expected {expected}.</p>}
      {amountMinor !== expectedAmountMinor && <p role="alert">{amount ? `Receipt amount differs from the expected ${expected}.` : `Could not read the amount. Enter it from the image (expected ${expected}).`}</p>}
      <label>Amount on receipt (PHP)<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} inputMode="decimal" value={amount} maxLength={12}
        placeholder={(expectedAmountMinor / 100).toFixed(2)} onChange={e => setAmount(e.target.value)} /></label>
      <label>Payment reference (any bank or e-wallet)<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} value={reference} maxLength={80}
        placeholder="Reference number on the receipt" onChange={e => { typed.current = true; onReference(e.target.value); }} /></label>
      {hasImage && <button type="button" onClick={() => { typed.current = false; void scanReceipt(); }}>Read receipt again</button>}
    </div>}
    <ReceiptRetentionControls key={receiptId} receiptId={receiptId} />
  </section>;
}
