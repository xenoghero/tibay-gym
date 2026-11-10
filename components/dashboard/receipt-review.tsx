"use client";

import { useRef, useState } from "react";
import type { PaymentAccountSnapshot } from "@/lib/finance/payment-methods";
import { readReceipt } from "@/lib/receipt-ocr";
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
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const image = useRef<Blob | null>(null), typed = useRef(false);
  async function scanReceipt() {
    if (!image.current || !onReference) return;
    setScan("scanning");
    try {
      const result = await readReceipt(image.current, expectedAmountMinor);
      setAmountMinor(result.amountMinor);
      if (result.reference && !typed.current) onReference(result.reference);
      setScan("done");
    } catch { setScan("failed"); }
  }
  return <section className={styles.receipt}><h3>Receipt</h3>
    <ReceiptImage key={`image-${receiptId}`} receiptId={receiptId} alt={paymentAccount ? `Private ${paymentAccount.name} receipt` : "Private payment receipt"}
      onImage={blob => { image.current = blob; void scanReceipt(); }} />
    {onReference && <div style={{ display: "grid", gap: 8 }}>
      {scan === "scanning" && <p role="status">Reading the receipt…</p>}
      {scan === "failed" && <p role="alert">The receipt could not be read. Type the reference from the image.</p>}
      {scan === "done" && amountMinor !== expectedAmountMinor && <p role="alert">{amountMinor === null ? "Could not read the amount." : `Receipt shows PHP ${(amountMinor / 100).toFixed(2)}.`} Expected PHP {(expectedAmountMinor / 100).toFixed(2)} — check the image.</p>}
      {scan === "done" && amountMinor === expectedAmountMinor && <p role="status">Receipt amount matches PHP {(expectedAmountMinor / 100).toFixed(2)}.</p>}
      <label>Payment reference (any bank or e-wallet)<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} value={reference} maxLength={80}
        placeholder={scan === "scanning" ? "Reading…" : "Reference number on the receipt"} onChange={e => { typed.current = true; onReference(e.target.value); }} /></label>
      {(scan === "done" || scan === "failed") && <button type="button" onClick={() => { typed.current = false; void scanReceipt(); }}>Read receipt again</button>}
    </div>}
    <ReceiptRetentionControls key={receiptId} receiptId={receiptId} />
  </section>;
}
