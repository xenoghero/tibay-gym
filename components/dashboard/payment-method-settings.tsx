"use client";

import { FormInput } from "@/components/ui/form-input";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth/auth-context";
import { gcashAccount, type PaymentAccount, type PaymentSettings } from "@/lib/finance/payment-methods";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { SettingsDrawer } from "./settings-drawer";
import { IconPayment, IconQr } from "./nav-icons";
import styles from "./settings.module.css";
import paymentStyles from "./payment-method-settings.module.css";

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
      if (!response.ok) throw new Error("Could not prepare this QR image. Choose a JPG, PNG or WebP image up to 5 MB and try again.");
      const { qrImage } = await response.json(); setDraft(current => current ? { ...current, qrImage } : null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not upload QR image."); }
    finally { setUploading(false); }
  }
  async function save() {
    if (!settings || !draft || busy || uploading) return;
    setBusy(true); setMessage("");
    try {
      const accounts = [{ ...draft, kind: "gcash", name: "GCash", enabled: true }];
      const body = { revision: settings.revision, accounts }, payload = JSON.stringify(body);
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
      const response = await fetch("/api/finance/payment-methods", { method: "POST", headers: { ...await headers(), "Content-Type": "application/json" }, body: JSON.stringify({ ...body, operationId: attempt.current.id }) });
      if (!response.ok) {
        if (response.status === 409) { await load(); attempt.current = null; throw new Error("Payment settings changed. Your draft is preserved. Review it and save again against the latest settings."); }
        throw new Error("Could not save payment account. Check the details and try again.");
      }
      setSettings(await response.json()); setDraft(null); attempt.current = null; setMessage("GCash details saved. Customers will see them on their next payment lookup.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save payment account."); }
    finally { setBusy(false); }
  }
  const account = gcashAccount(settings?.accounts ?? []);
  return <section className={`${styles.section} ${paymentStyles.layout}`} aria-labelledby="payment-settings-title">
    <div className={styles.head}><div><h2 id="payment-settings-title">Payment methods</h2><p className={styles.sub}>Accept payments through Cash and GCash.</p></div></div>
    <section className={paymentStyles.cash} aria-labelledby="cash-method-title">
      <span className={paymentStyles.methodIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 9v6m12-6v6" /></svg></span>
      <div className={paymentStyles.methodTitle}><h3 id="cash-method-title">Cash</h3><p>Collected at the front desk.</p></div>
      <span className={paymentStyles.cashAvailability}>Always available</span>
    </section>
    {loading ? <LoadingSkeleton label="Loading payment details..." /> : !settings ? <button onClick={() => load().catch(error => setMessage(error.message))}>Retry loading details</button> : <section className={paymentStyles.accountCard} aria-labelledby="gcash-method-title">
      <header className={paymentStyles.accountHeader}>
        <span className={`${paymentStyles.methodIcon} ${paymentStyles.walletIcon}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" /><path d="M20 12h-5v5h5M17 14.5h.01" /></svg></span>
        <div className={paymentStyles.methodTitle}><h3 id="gcash-method-title">GCash</h3><p>Receiving account</p></div>
        <span className={paymentStyles.accountStatus} data-configured={Boolean(account?.enabled)}>{account?.enabled ? "Configured" : "Needs setup"}</span>
      </header>
      {account ? <dl className={paymentStyles.accountDetails}>
        <div><dt>Account holder</dt><dd>{account.accountHolder}</dd></div>
        <div><dt>Mobile number</dt><dd className={paymentStyles.mobileNumber}>{account.accountNumber}</dd></div>
      </dl> : <p className={`${styles.sub} ${paymentStyles.setupHint}`}>Add the receiving name, mobile number, and payment QR in GCash details.</p>}
      <figure className={paymentStyles.accountQr}>
        {account?.qrImage ? <Image unoptimized src={account.qrImage} alt="GCash payment QR code" width={240} height={240} className={paymentStyles.qrImage} /> : <div className={paymentStyles.qrEmpty}><IconQr size={32} /><span>No QR image uploaded</span></div>}
        <figcaption>{account?.qrImage ? "Payment QR" : "Upload a QR in GCash details."}</figcaption>
      </figure>
      <p className={paymentStyles.receiptNote}><IconPayment size={16} /><span>Receipt upload and admin approval required.</span></p>
      <button className={`${styles.primary} ${paymentStyles.editButton}`} onClick={() => { setMessage(""); setDraft({ ...(account ?? { id: `account_${crypto.randomUUID()}`, kind: "gcash", name: "GCash", accountHolder: "", accountNumber: "", qrImage: null, enabled: true }), name: "GCash", enabled: true }); }}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="m14 5 5 5M4 20l1-6L16 3a2 2 0 0 1 3 3L8 19l-4 1Z" /></svg>Edit GCash details</button>
    </section>}
    {message && !draft && <p className={styles.message} role="status">{message}</p>}
    {draft && <SettingsDrawer closeLabel="Close payment account drawer" title="Edit GCash details" busy={busy || uploading} closing={false} onExited={() => setDraft(null)} onClose={() => setDraft(null)}>
      <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save(); }}><div className={styles.fields}>
        <label>Account holder<input required maxLength={100} value={draft.accountHolder} disabled={busy || uploading} onChange={event => setDraft({ ...draft, accountHolder: event.target.value })} /></label>
        <label>Account / mobile number<FormInput type="tel" inputMode="numeric" required maxLength={100} value={draft.accountNumber} disabled={busy || uploading} onChange={event => setDraft({ ...draft, accountNumber: event.target.value })} /></label>
        <label className={styles.full}>Payment QR image (optional)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /><small>JPG, PNG or WebP up to 5 MB. Images are optimized automatically; no minimum resolution is required.</small></label>
        {draft.qrImage && <div className={styles.full}><Image unoptimized src={draft.qrImage} alt={`${draft.name} payment QR preview`} width={240} height={240} className={styles.qrPreview} /><button type="button" disabled={busy || uploading} onClick={() => setDraft({ ...draft, qrImage: null })}>Remove QR image</button></div>}
      </div><p className={styles.sub}>Verify that the QR code and account details belong to the same GCash account. Pending payments keep their submitted details.</p>
      {message && <p className={styles.message} role="status">{message}</p>}
      <div className={styles.footer}><span className={styles.sub}>{uploading ? "Preparing QR image…" : "Changes apply after saving."}</span><div className={styles.actions}><button type="button" disabled={busy || uploading} onClick={() => setDraft(null)}>Cancel</button><button className={styles.primary} disabled={busy || uploading}>{busy ? "Saving…" : "Save GCash details"}</button></div></div></form>
    </SettingsDrawer>}
  </section>;
}
