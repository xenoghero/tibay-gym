"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth/auth-context";
import type { PaymentAccount, PaymentSettings } from "@/lib/finance/payment-methods";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { SettingsDrawer } from "./settings-drawer";
import styles from "./settings.module.css";

export function PaymentMethodSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [draft, setDraft] = useState<PaymentAccount | null>(null);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  async function headers() { return { Authorization: `Bearer ${await user?.getIdToken()}` }; }
  async function load() {
    const response = await fetch("/api/finance/payment-methods", { headers: await headers() });
    if (!response.ok) throw new Error("Could not load payment accounts. Try again.");
    setSettings(await response.json());
  }
  useEffect(() => {
    let active = true;
    if (user) user.getIdToken().then(token => fetch("/api/finance/payment-methods", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Could not load payment accounts. Try again."); const data = await response.json(); if (active) setSettings(data); })
      .catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  async function upload(file?: File) {
    if (!file || !draft) return;
    setUploading(true); setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP QR image up to 5 MB.");
      const response = await fetch("/api/finance/payment-methods/qr", { method: "POST", headers: { ...await headers(), "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("Could not prepare this QR image. Use a clear image cropped around the QR code and try again.");
      const { qrImage } = await response.json(); setDraft(current => current ? { ...current, qrImage } : null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not upload QR image."); }
    finally { setUploading(false); }
  }
  async function save() {
    if (!settings || !draft || busy || uploading) return;
    setBusy(true); setMessage("");
    try {
      const accounts = settings.accounts.some(account => account.id === draft.id) ? settings.accounts.map(account => account.id === draft.id ? draft : account) : [...settings.accounts, draft];
      const body = { revision: settings.revision, accounts }, payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
      const response = await fetch("/api/finance/payment-methods", { method: "POST", headers: { ...await headers(), "Content-Type": "application/json" }, body: JSON.stringify({ ...body, operationId: attempt.current.id }) });
      if (!response.ok) {
        if (response.status === 409) { await load(); attempt.current = null; throw new Error("Payment settings changed. Your draft is preserved. Review it and save again against the latest settings."); }
        throw new Error("Could not save payment account. Check the details and try again.");
      }
      setSettings(await response.json()); setDraft(null); attempt.current = null; setMessage("Payment account saved. Customers will see enabled accounts on their next payment lookup.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save payment account."); }
    finally { setBusy(false); }
  }
  return <section className={styles.section} aria-labelledby="payment-settings-title">
    <div className={styles.head}><div><h2 id="payment-settings-title">Payment methods</h2><p className={styles.sub}>Accounts customers can use for daily visits, membership purchases, and renewals.</p></div><button className={styles.primary} disabled={!settings || settings.accounts.length >= 6} onClick={() => { setMessage(""); setDraft({ id: `account_${crypto.randomUUID()}`, kind: "gcash", name: "GCash", accountHolder: "", accountNumber: "", qrImage: null, enabled: true }); }}>Add payment account</button></div>
    <p className={styles.sub}>Cash is always available at the front desk. Electronic payments require a receipt and admin approval. Up to six accounts; disable accounts you no longer accept.</p>
    {loading ? <LoadingSkeleton label="Loading payment accounts…" /> : !settings ? <button onClick={() => load().catch(error => setMessage(error.message))}>Retry loading accounts</button> : !settings.accounts.length ? <div className={styles.empty}><h3>No electronic payment accounts yet</h3><p>Add your GCash, Maya, or bank details and an optional payment QR image.</p></div> : <table className={styles.table}><thead><tr><th>Payment account</th><th>Account details</th><th>Status</th><th>Action</th></tr></thead><tbody>{settings.accounts.map(account => <tr key={account.id}><td><strong>{account.name}</strong><small>{account.kind === "bank" ? "Bank transfer" : account.kind === "gcash" ? "GCash" : "Maya"} · {account.qrImage ? "QR added" : "Account details only"}</small></td><td>{account.accountHolder}<small className={styles.code}>{account.accountNumber}</small></td><td><span className={styles.status} data-status={account.enabled ? "available" : "disabled"}>{account.enabled ? "Enabled" : "Disabled"}</span></td><td><button aria-label={`Edit ${account.name}`} onClick={() => { setMessage(""); setDraft({ ...account }); }}>Edit</button></td></tr>)}</tbody></table>}
    {message && !draft && <p className={styles.message} role="status">{message}</p>}
    {draft && <SettingsDrawer closeLabel="Close payment account drawer" title={settings?.accounts.some(account => account.id === draft.id) ? "Edit payment account" : "Add payment account"} busy={busy || uploading} closing={false} onExited={() => setDraft(null)} onClose={() => setDraft(null)}>
      <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save(); }}><div className={styles.fields}>
        <label>Account type<select value={draft.kind} disabled={busy || uploading} onChange={event => setDraft({ ...draft, kind: event.target.value as PaymentAccount["kind"] })}><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank">Bank transfer</option></select></label>
        <label>Display name<input required maxLength={100} value={draft.name} disabled={busy || uploading} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. BPI savings" /></label>
        <label>Account holder<input required maxLength={100} value={draft.accountHolder} disabled={busy || uploading} onChange={event => setDraft({ ...draft, accountHolder: event.target.value })} /></label>
        <label>Account / mobile number<input required maxLength={100} value={draft.accountNumber} disabled={busy || uploading} onChange={event => setDraft({ ...draft, accountNumber: event.target.value })} /></label>
        <label className={styles.full}>Payment QR image (optional)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /><small>JPG, PNG or WebP up to 5 MB. Use a clear QR image with its white border intact.</small></label>
        {draft.qrImage && <div className={styles.full}><Image unoptimized src={draft.qrImage} alt={`${draft.name} payment QR preview`} width={240} height={240} className={styles.qrPreview} /><button type="button" disabled={busy || uploading} onClick={() => setDraft({ ...draft, qrImage: null })}>Remove QR image</button></div>}
        <div className={`${styles.checkGroup} ${styles.full}`}><label><input type="checkbox" checked={draft.enabled} disabled={busy || uploading} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enabled for customer payments</label></div>
      </div><p className={styles.sub}>Verify that the QR code and account details belong to the same account. Disabling blocks new submissions; pending payments keep their submitted details.</p>
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.footer}><span className={styles.sub}>{uploading ? "Preparing QR image…" : "Changes apply after saving."}</span><div className={styles.actions}><button type="button" disabled={busy || uploading} onClick={() => setDraft(null)}>Cancel</button><button className={styles.primary} disabled={busy || uploading}>{busy ? "Saving…" : "Save payment account"}</button></div></div></form>
    </SettingsDrawer>}
  </section>;
}
