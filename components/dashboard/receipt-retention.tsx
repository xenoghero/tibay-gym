"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { ReceiptRetention } from "@/lib/receipt-retention";

export function ReceiptRetentionControls({ receiptId }: { receiptId: string }) {
  const { user } = useAuth();
  const [policy, setPolicy] = useState<ReceiptRetention | null>(null), [status, setStatus] = useState("");
  const [dispute, setDispute] = useState(false), [legal, setLegal] = useState(false);
  const [deadline, setDeadline] = useState(""), [filed, setFiled] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (user) void user.getIdToken().then(async token => {
      const response = await fetch(`/api/receipts/retention?id=${encodeURIComponent(receiptId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Receipt retention is unavailable. Refresh to try again.");
      const next = await response.json();
      if (!active) return;
      setPolicy(next.policy); setStatus(next.paymentStatus); setDispute(next.policy.disputeHold); setLegal(next.policy.legalHold);
      setDeadline(next.policy.filingDeadline ?? ""); setFiled(next.policy.filedAt ?? "");
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [user, receiptId, reload]);
  async function save() {
    if (!user || !policy) return;
    setBusy(true); setMessage("");
    try {
      if (!!deadline !== !!filed) throw new Error("Enter both filing dates, or leave both empty to keep accounting protection.");
      const body = { receiptId, disputeHold: dispute, legalHold: legal, filingDeadline: deadline || null, filedAt: filed || null, expectedRevision: policy.revision };
      const payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
      const headers = { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" };
      const result = await fetch("/api/receipts/retention", { method: "POST", headers, body: JSON.stringify({ ...body, operationId: attempt.current.id }) });
      if (!result.ok) throw new Error("Could not save. Check the filing dates and refresh if another review or cleanup changed this receipt.");
      const response = await fetch(`/api/receipts/retention?id=${encodeURIComponent(receiptId)}`, { headers });
      if (!response.ok) throw new Error("Saved; refresh to see the latest retention policy.");
      const next = await response.json(); setPolicy(next.policy); setStatus(next.paymentStatus);
      setDispute(next.policy.disputeHold); setLegal(next.policy.legalHold);
      setDeadline(next.policy.filingDeadline ?? ""); setFiled(next.policy.filedAt ?? "");
      attempt.current = null; setMessage("Receipt retention saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save retention."); }
    finally { setBusy(false); }
  }
  return <details style={{ marginBlock: 16 }}><summary>Receipt retention and holds</summary>
    <p>Rejected or replaced evidence is removed 180 days after its final rejection. Pending reviews and active holds pause removal. Minimal financial and audit records remain.</p>
    {policy && <fieldset disabled={busy || !!policy.purgeState} style={{ display: "grid", gap: 12 }}>
      {policy.purgeState ? <p>Evidence removal {policy.purgeState === "purged" ? "completed" : "has started"}. Holds can no longer be changed.</p> : <>
        <label><input type="checkbox" checked={dispute} onChange={event => setDispute(event.target.checked)} /> Keep evidence for an open dispute</label>
        <label><input type="checkbox" checked={legal} onChange={event => setLegal(event.target.checked)} /> Keep evidence for a legal or accounting hold</label>
        {status === "approved" && <>
          <p>Approved evidence stays protected until you confirm the relevant tax return dates with your bookkeeper. Enter dates for the accounting year containing this payment. Saving both dates confirms the five-year accounting period applies; keep a hold for any longer requirement.</p>
          <label>Return filing deadline<input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} style={{ display: "block", minHeight: 44 }} /></label>
          <label>Actual return filing date<input type="date" value={filed} onChange={event => setFiled(event.target.value)} style={{ display: "block", minHeight: 44 }} /></label>
          <p>{policy.accountingDeleteAfter ? `Eligible for removal from ${new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "Asia/Manila" }).format(policy.accountingDeleteAfter)}, unless held.` : "Accounting protection is active; no automatic removal date is set."}</p>
        </>}
        <button onClick={() => void save()}>Save retention and holds</button>
      </>}
    </fieldset>}
    {!policy && !message && <p role="status">Loading retention policy…</p>}
    <button disabled={busy} onClick={() => { setPolicy(null); setMessage(""); setReload(value => value + 1); }}>Refresh retention</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
