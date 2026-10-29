"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { parsePesoInput } from "@/lib/finance/rules";
import styles from "./payment-review.module.css";
import { ReceiptRetentionControls } from "./receipt-retention";
import { ReceiptImage } from "./receipt-image";
interface ReviewData {
  receipt: { ocr_status: string; extracted_reference: string | null; extracted_amount_minor: number | null; confidence: number | null; raw_text: string | null; processed_at?: string | null; lease_until?: string | null };
  canExtract: boolean;
  review: { confirmedReference?: string; confirmedAmountMinor?: number; reviewRevision: number };
  referenceAlreadyClaimed: boolean; otherReceiptsUsingReference: number;
}
export function ReceiptReview({ receiptId, expectedAmountMinor, onReviewed }: { receiptId: string; expectedAmountMinor: number; onReviewed?: (revision: number) => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<ReviewData | null>(null);
  const [reference, setReference] = useState(""), [amount, setAmount] = useState(""), [reason, setReason] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  function display(next: ReviewData) { setData(next); setReference(next.review.confirmedReference ?? next.receipt.extracted_reference ?? "");
    const minor = next.review.confirmedAmountMinor ?? next.receipt.extracted_amount_minor;
    setAmount(minor ? (minor / 100).toFixed(2) : ""); }
  async function load() {
    if (!user) return;
    const response = await fetch(`/api/receipts/review?id=${encodeURIComponent(receiptId)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
    if (!response.ok) throw new Error("Receipt review is unavailable. Check the private receipt setup or retry later.");
    display(await response.json());
  }
  async function readReview(token: string, signal?: AbortSignal): Promise<ReviewData> {
    const response = await fetch(`/api/receipts/review?id=${encodeURIComponent(receiptId)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error("Receipt review is unavailable. Refresh to try again.");
    return response.json();
  }
  async function extract(token: string, force: boolean, signal?: AbortSignal): Promise<ReviewData> {
    const response = await fetch("/api/receipts/review", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "extract", receiptId, ...(force ? { force: true } : {}) }), signal });
    if (!response.ok) throw new Error("Could not scan this receipt. Try Scan again or enter the reference and amount manually.");
    const result = await response.json();
    // Another open review may already be scanning this exact receipt. Read its result; never dispatch a batch.
    const deadline = Date.now() + 95_000;
    let next = await readReview(token, signal);
    while (result.status === "processing" && next.receipt.ocr_status === "processing" && Date.now() < deadline) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 1500);
        if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      });
      next = await readReview(token, signal);
    }
    if (next.receipt.ocr_status === "processing") throw new Error("This receipt is still being scanned. Refresh shortly, or enter the values manually.");
    return next;
  }
  useEffect(() => {
    if (!user) return;
    let active = true;
    const controller = new AbortController();
    void user.getIdToken().then(async token => {
      const next = await readReview(token, controller.signal);
      if (!active) return;
      display(next);
      const shouldScan = next.canExtract && !next.review.confirmedReference && next.review.confirmedAmountMinor == null
        && (!next.receipt.processed_at || next.receipt.ocr_status === "queued" || next.receipt.ocr_status === "failed" || next.receipt.ocr_status === "processing");
      if (shouldScan) {
        setScanning(true);
        try { const scanned = await extract(token, false, controller.signal); if (active) display(scanned); }
        finally { if (active) setScanning(false); }
      }
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; controller.abort(); };
    // These functions use only this receipt ID; callbacks must not restart extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, receiptId]);
  async function save() {
    if (!user || !data) return;
    setBusy(true); setMessage("");
    try {
      const amountMinor = parsePesoInput(amount);
      if (!amountMinor || !reason.trim()) throw new Error("Enter the reference, positive amount, and review reason.");
      const body = { receiptId, reference, amountMinor, reason, expectedRevision: data.review.reviewRevision };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
      const response = await fetch("/api/receipts/review", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ ...body, operationId: attempt.current.id }) });
      if (!response.ok) throw new Error("Could not save this review. Refresh the receipt and check whether its review changed.");
      const result = await response.json(); attempt.current = null; await load(); onReviewed?.(result.reviewRevision);
      setMessage("Reviewed reference and amount saved. Payment still requires an approval decision.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save receipt review."); }
    finally { setBusy(false); }
  }
  async function scanAgain() {
    if (!user || scanning || busy) return;
    setScanning(true); setMessage("");
    try { display(await extract(await user.getIdToken(), true)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not scan this receipt."); }
    finally { setScanning(false); }
  }
  return <section className={styles.receipt}><h3>Private receipt review</h3>
    <p>Check the receipt against the gym&apos;s received GCash transaction. OCR is a suggestion; saving a review does not approve payment.</p>
    {!data && !message && <LoadingSkeleton label="Loading receipt…" variant="form" />}
    {scanning && <p role="status">Scanning this receipt for the reference and amount…</p>}
    <ReceiptImage key={`image-${receiptId}`} receiptId={receiptId} />
    {data && <>{!scanning && data.receipt.ocr_status === "failed" && <p role="alert">The receipt could not be read. Scan again or enter the values manually.</p>}{!scanning && data.receipt.ocr_status === "needs_review" && data.receipt.processed_at && <p role="status">Check the detected values. Unclear or conflicting details need manual review.</p>}<p>OCR: {scanning ? "Scanning" : data.receipt.ocr_status === "queued" || !data.receipt.processed_at && data.receipt.ocr_status === "needs_review" ? "Not scanned" : data.receipt.ocr_status} · Confidence: {data.receipt.confidence ?? "unavailable"}% · Expected: PHP {(expectedAmountMinor / 100).toFixed(2)}</p>
      {(data.referenceAlreadyClaimed || data.otherReceiptsUsingReference > 0) && <p role="alert">This reference appears on another receipt or approved payment. Resolve the conflict before approval.</p>}
      {data.receipt.extracted_amount_minor !== null && data.receipt.extracted_amount_minor !== expectedAmountMinor && <p role="alert">The extracted amount differs from the expected charge. Check the actual receipt and funds received.</p>}
      <div style={{ display: "grid", gap: 12 }}>
        <label>GCash reference<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} value={reference} maxLength={80} disabled={busy || scanning || !data?.canExtract} onChange={e => setReference(e.target.value)} /></label>
        <label>Reviewed amount (PHP)<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} inputMode="decimal" value={amount} disabled={busy || scanning || !data?.canExtract} onChange={e => setAmount(e.target.value)} /></label>
        <label>Review reason<input style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }} value={reason} maxLength={500} disabled={busy || scanning || !data?.canExtract} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={busy || scanning || !data?.canExtract} onClick={() => void save()}>Save reviewed reference and amount</button>
      </div>
      <details><summary>Private extraction evidence</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{data.receipt.raw_text ?? "No extracted text yet."}</pre></details>
    </>}
    <div className={styles.receiptActions}><button disabled={busy || scanning} onClick={() => load().catch(e => setMessage(e.message))}>Refresh receipt</button>{data?.canExtract && <button disabled={busy || scanning} onClick={() => void scanAgain()}>{scanning ? "Scanning…" : "Scan again"}</button>}</div>
    <ReceiptRetentionControls key={receiptId} receiptId={receiptId} />
    {message && <p role="status">{message}</p>}
  </section>;
}
