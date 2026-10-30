"use client";
import { useId, useState } from "react";
import type { DiscountQuote } from "@/lib/finance/vouchers";
import { voucherMessages } from "@/lib/finance/vouchers";
import styles from "./voucher-entry.module.css";

export const voucherError = (code?: string) => voucherMessages[code ?? ""] ?? "Could not refresh this price. Try again before submitting.";
export function VoucherEntry({ quote, disabled, onApply }: {
  quote?: Partial<DiscountQuote> | null; disabled?: boolean; onApply(code: string): Promise<void>;
}) {
  const id = useId(), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function apply(value: string) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await onApply(value); setCode(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not apply this code. Try again."); }
    finally { setBusy(false); }
  }
  return <div className={styles.entry}>
    {quote?.voucherSnapshot && <div className={styles.applied}><span><strong>{quote.voucherSnapshot.code}</strong> applied</span><button type="button" disabled={disabled || busy} onClick={() => void apply("")}>Remove</button></div>}
    <details><summary>{quote?.voucherSnapshot ? "Use a different voucher" : "Have a voucher?"}</summary>
      <label htmlFor={id}>Voucher code</label>
      <div className={styles.inputRow}><input id={id} value={code} maxLength={24} autoComplete="off" autoCapitalize="characters" spellCheck={false}
        disabled={disabled || busy} aria-invalid={!!error} aria-describedby={`${id}-error`} onChange={e => setCode(e.target.value.toUpperCase())}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (code.trim()) void apply(code.trim()); } }} />
        <button type="button" disabled={disabled || busy || !code.trim()} onClick={() => void apply(code.trim())}>{busy ? "Applying…" : "Apply"}</button></div>
      <small>One voucher per purchase. Availability is checked on submission.</small>
    </details>
    <p id={`${id}-error`} role="status" className={styles.error}>{error}</p>
  </div>;
}
export function PriceBreakdown({ quote }: { quote: Partial<DiscountQuote> & { amountMinor: number } }) {
  const money = (v: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v / 100);
  return <dl className={styles.breakdown}>
    {quote.voucherSnapshot && <><div><dt>Base price</dt><dd>{money(quote.baseAmountMinor ?? quote.amountMinor)}</dd></div><div><dt>Voucher {quote.voucherSnapshot.code}</dt><dd>−{money(quote.discountAmountMinor ?? 0)}</dd></div></>}
    <div className={styles.total}><dt>Total to pay</dt><dd>{money(quote.amountMinor)}</dd></div>
  </dl>;
}
