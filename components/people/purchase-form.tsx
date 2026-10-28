"use client";
import { RECEIPT_RETENTION_NOTICE } from "@/lib/receipt-retention";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { PurchaseQuote } from "@/lib/server/purchases";
type Quote = PurchaseQuote & { gcashAvailable?: boolean };
export function PurchaseForm({ admin = false, personId, previousRequestId, onSubmitted }: { admin?: boolean; personId?: string; previousRequestId?: string; onSubmitted?: () => void }) {
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null), [method, setMethod] = useState<"cash" | "gcash">("cash");
  const [file, setFile] = useState<File | null>(null), [fileKey, setFileKey] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<{ key: string; id: string; proof?: { receiptId: string; receiptToken: string } } | null>(null);
  const endpoint = admin ? `/api/finance/purchases?personId=${encodeURIComponent(personId ?? "")}` : `/api/customer/purchase${previousRequestId ? `?previousRequestId=${encodeURIComponent(previousRequestId)}` : ""}`;
  async function headers(): Promise<Record<string, string>> { return admin ? { Authorization: `Bearer ${await user?.getIdToken()}` } : {}; }
  async function refresh() {
    const response = await fetch(endpoint, { headers: await headers() });
    if (!response.ok) { setQuote(null); throw new Error("A purchase quote is unavailable. Ask the admin to verify the profile, rate category, and monthly price, then refresh."); }
    setQuote(await response.json());
  }
  useEffect(() => {
    let active = true;
    const token = admin ? user?.getIdToken() : Promise.resolve(null);
    if (!token) return;
    token.then(value => fetch(endpoint, { headers: value ? { Authorization: `Bearer ${value}` } : {} }))
      .then(async response => { if (!response.ok) throw new Error("A purchase quote is unavailable. Ask the admin to verify the profile, category, and monthly price."); const data = await response.json(); if (active) setQuote(data); })
      .catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [user, admin, endpoint]);
  async function submit() {
    if (!quote || busy) return;
    setBusy(true); setMessage("");
    try {
      const body = { method, quoteToken: quote.quoteToken, ...(personId && admin ? { personId } : {}), ...(previousRequestId ? { previousRequestId } : {}) };
      const key = JSON.stringify([body, fileKey]);
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      const current = attempt.current;
      if (method === "gcash" && !current.proof) {
        if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP receipt up to 5 MB.");
        const uploaded = await fetch("/api/receipts/upload", { method: "POST", headers: { "Content-Type": file.type, "x-operation-id": current.id,
          "x-expected-amount": String(quote.amountMinor), "x-charge-kind": quote.kind, ...(previousRequestId ? { "x-previous-request-id": previousRequestId } : {}) }, body: file });
        if (!uploaded.ok) throw new Error("Receipt upload did not complete. Retry the same image or choose cash. No membership was activated.");
        current.proof = await uploaded.json();
      }
      const response = await fetch(admin ? "/api/finance/purchases" : "/api/customer/purchase", { method: "POST", headers: { "Content-Type": "application/json", ...await headers() },
        body: JSON.stringify({ ...body, operationId: current.id, ...(current.proof ?? {}) }) });
      if (!response.ok) throw new Error("Could not confirm this request. Check payment status, refresh the quote, and retry. An existing pending request must be reviewed first.");
      attempt.current = null; setQuote(null); setMessage("Payment request submitted for admin review. Membership is unchanged until approval."); onSubmitted?.();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not submit the request. Retry to recover it safely."); }
    finally { setBusy(false); }
  }
  return <section className="rs-financial-ui" style={{ display: "grid", gap: 14, marginBlock: 20 }}><h2>{previousRequestId ? "Replace rejected payment" : "Membership purchase / renewal"}</h2>
    <p>One month at the configured price. Package and custom-expiry purchase prices await an agreed policy.</p>
    {!quote && !message && <p role="status">Loading configured price and coverage…</p>}
    {quote && <><p><strong>PHP {(quote.amountMinor / 100).toFixed(2)}</strong> · {quote.categorySnapshot} · {quote.kind.replaceAll("_", " ")}</p>
      {quote.coverage && <p>Preview: {quote.coverage.startDate} to {quote.coverage.expiryDate}. Final dates are calculated at approval; active memberships extend from the current expiry.</p>}
      <label>Payment method<select aria-label="Purchase payment method" value={method} disabled={busy} onChange={e => setMethod(e.target.value as "cash" | "gcash")} style={{ display: "block", minHeight: 44, fontSize: 16, width: "100%" }}>
        <option value="cash">Cash — pending confirmation</option>{!admin && <option value="gcash" disabled={!quote.gcashAvailable}>GCash{!quote.gcashAvailable ? " — receipt setup pending" : ""}</option>}
      </select></label>
      {method === "gcash" && <label>GCash receipt<input aria-label="Purchase receipt" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setFileKey(crypto.randomUUID()); }} /><p>Submit evidence only for money already sent to the gym&apos;s confirmed GCash account.</p><p>{RECEIPT_RETENTION_NOTICE}</p></label>}
      <button disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit payment request for review"}</button>
    </>}
    <button type="button" disabled={busy} onClick={() => refresh().catch(e => setMessage(e.message))}>Refresh purchase quote</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
export function NewProfilePurchaseQuote({ category, onQuote }: { category: string; onQuote(quote: PurchaseQuote | null): void }) {
  const { user } = useAuth(); const [message, setMessage] = useState("Choose a category to review monthly pricing.");
  useEffect(() => {
    let active = true;
    if (user && category) user.getIdToken().then(token => fetch(`/api/finance/purchases?category=${encodeURIComponent(category)}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Configure the applicable monthly rate in Settings before creating a membership request."); const quote: PurchaseQuote = await response.json();
        if (active) { onQuote(quote); setMessage(`One month: PHP ${(quote.amountMinor / 100).toFixed(2)}. Coverage preview ${quote.coverage?.startDate} to ${quote.coverage?.expiryDate}. The profile remains a guest until payment approval.`); } })
      .catch(e => { if (active) { onQuote(null); setMessage(e.message); } });
    return () => { active = false; };
  }, [user, category, onQuote]);
  return <section><h2>New membership request</h2><p role="status">{message}</p><p>Saving creates the profile and a pending cash request. Confirm actual receipt of funds in Payment review to activate membership.</p></section>;
}
