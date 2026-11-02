"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { MAX_PROMOTIONS, PROMOTION_MAX_BYTES, type PromotionSettings as Settings } from "@/lib/promotions";
import styles from "./settings.module.css";
import promo from "./promotion-settings.module.css";

const messages: Record<string, string> = {
  "promotion-dimensions-required": "Use a 3:1 landscape image, at least 900 × 300 px. Recommended: 1500 × 500 px.",
  "image-too-large": "Choose an image smaller than 5 MB.",
  "image-format-required": "Choose a JPG, PNG, or WebP image.",
  "invalid-image": "This image could not be read. Export it as JPG, PNG, or WebP and try again.",
  "promotion-limit": `You can upload up to ${MAX_PROMOTIONS} banners. Remove one before adding another.`,
  "settings-changed": "Promotions changed in another session. Reload to review the latest banners.",
};
export function PromotionSettings() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings["banners"]>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const [file, setFile] = useState<File | null>(null), [title, setTitle] = useState(""), [preview, setPreview] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const uploadId = useRef("");
  const inFlight = useRef(false);
  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved.banners);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken().then(token => fetch("/api/admin/promotions", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error("Could not load promotions.");
        const data: Settings = await response.json();
        if (active) { setSaved(data); setDraft(data.banners); setStale(false); setError(""); }
      }).catch(() => { if (active) setError("Could not load promotions. Reload to try again."); });
    return () => { active = false; };
  }, [user, reload]);

  async function mutate(upload: boolean) {
    if (!user || !saved || inFlight.current || stale || (upload && (!file || dirty))) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await user.getIdToken();
      if (upload && !uploadId.current) uploadId.current = crypto.randomUUID();
      const response = await fetch("/api/admin/promotions", {
        method: upload ? "PUT" : "POST", signal: AbortSignal.timeout(30_000), headers: {
          Authorization: `Bearer ${token}`, "Content-Type": upload ? file!.type : "application/json",
          ...(upload ? { "x-promotion-id": uploadId.current, "x-promotion-title": encodeURIComponent(title.trim()) } : {}),
        }, body: upload ? file : JSON.stringify({ revision: saved.revision, banners: draft.map(({ id, title, enabled }) => ({ id, title, enabled })) }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || response.status === 409) setStale(true);
        throw new Error(messages[data.error] ?? "Could not confirm the change. Reload to check the saved promotions.");
      }
      setSaved(data); setDraft(data.banners);
      if (upload) { setFile(null); setPreview(""); setTitle(""); uploadId.current = ""; if (input.current) input.current.value = ""; }
      setMessage(upload ? "Banner uploaded and published on the check-in page." : "Promotions saved.");
    } catch (err) {
      if (!(err instanceof Error) || !Object.values(messages).includes(err.message)) setStale(true);
      setError(err instanceof Error ? err.message : "Could not confirm the change. Reload promotions before trying again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  function move(index: number, direction: -1 | 1) {
    setDraft(current => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  function upload(event: FormEvent) { event.preventDefault(); void mutate(true); }
  const locked = busy || stale || !saved;

  return <section className={styles.section} aria-labelledby="promotions-title">
    <header className={styles.head}><div><h2 id="promotions-title">Check-in promotions</h2>
      <p className={styles.sub}>Promotional banners appear below the customer check-in choices. With no visible banners, the area stays hidden.</p></div></header>
    <div className={promo.guide}><strong>Design your banner at 1500 × 500 px</strong>
      <p>3:1 landscape · JPG, PNG, or WebP · up to 5 MB · minimum 900 × 300 px.</p>
      <p>The whole image is shown without cropping. Use large text that stays readable on a phone. Up to {MAX_PROMOTIONS} banners rotate every 6 seconds.</p></div>
    {!saved && !error && <p role="status">Loading promotions…</p>}
    {error && <div className={promo.error} role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setError(""); setSaved(null); setReload(value => value + 1); }}>Reload promotions</button></div>}
    {message && <p role="status">{message}</p>}
    {saved && <>
      <form className={promo.upload} onSubmit={upload}>
        <h3>Add a banner</h3>
        <p className={styles.sub}>Uploads publish immediately. {dirty ? "Save or discard your changes before uploading." : "New banners are added to the end of the rotation."}</p>
        <div><label>Banner image<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" required disabled={locked || dirty || draft.length >= MAX_PROMOTIONS}
          aria-describedby="promotion-file-hint" onChange={event => {
            const next = event.target.files?.[0] ?? null;
            uploadId.current = ""; setFile(null); setPreview(""); setError("");
            if (next && (! ["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size > PROMOTION_MAX_BYTES)) {
              setError(next.size > PROMOTION_MAX_BYTES ? messages["image-too-large"] : messages["image-format-required"]); event.target.value = ""; return;
            }
            setFile(next); if (next) setPreview(URL.createObjectURL(next));
          }} /></label><small id="promotion-file-hint">1500 × 500 px recommended. Only 3:1 images are accepted.</small></div>
        {preview && <Image className={promo.preview} src={preview} alt="Selected banner preview" width={1500} height={500} unoptimized />}
        <div><label>Banner description<input value={title} required maxLength={160} disabled={locked || dirty} aria-describedby="promotion-description-hint" onChange={event => setTitle(event.target.value)} placeholder="e.g. November offer: bring a friend for a free trial" /></label><small id="promotion-description-hint">Include the offer and important details shown in the image.</small></div>
        <button className={styles.primary} disabled={locked || dirty || !file || !title.trim() || draft.length >= MAX_PROMOTIONS} type="submit">{busy ? "Publishing…" : "Upload & publish"}</button>
      </form>
      <div className={promo.listHead}><h3>Banner rotation</h3><span>{draft.filter(item => item.enabled).length} visible · {draft.length}/{MAX_PROMOTIONS} uploaded</span></div>
      {draft.length === 0 ? <div className={promo.empty}><strong>No promotions yet</strong><p>Use the form above to upload your first banner. Customers will see only the check-in choices until you publish one.</p></div>
        : <ol className={promo.list}>{draft.map((banner, index) => <li key={banner.id} className={promo.item}>
          <Image className={promo.thumbnail} src={banner.imageUrl} alt={banner.title} width={1500} height={500} unoptimized />
          <div className={promo.details}>
            <label>Banner {index + 1} description<input value={banner.title} maxLength={160} disabled={locked} aria-describedby={`promotion-hint-${banner.id}`} onChange={event => setDraft(current => current.map(item => item.id === banner.id ? { ...item, title: event.target.value } : item))} /></label>
            <small id={`promotion-hint-${banner.id}`}>Describe the offer for customers using screen readers.</small>
            <div className={promo.actions}>
              <label className={promo.toggle}><input type="checkbox" checked={banner.enabled} disabled={locked} onChange={event => setDraft(current => current.map(item => item.id === banner.id ? { ...item, enabled: event.target.checked } : item))} />Visible on check-in</label>
              <button type="button" aria-label={`Move banner ${index + 1} earlier`} disabled={locked || index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`Move banner ${index + 1} later`} disabled={locked || index === draft.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label={`Remove banner ${index + 1}`} className={promo.remove} disabled={locked} onClick={() => setDraft(current => current.filter(item => item.id !== banner.id))}>Remove</button>
            </div>
          </div>
        </li>)}</ol>}
      <div className={promo.save}><button type="button" className={styles.primary} disabled={locked || !dirty || draft.some(banner => !banner.title.trim())} onClick={() => void mutate(false)}>{busy ? "Saving…" : "Save changes"}</button>
        <button type="button" disabled={locked || !dirty} onClick={() => { setDraft(saved.banners); setMessage(""); }}>Discard changes</button>
        {dirty && <span>Order, visibility, and removals publish when you save.</span>}</div>
    </>}
  </section>;
}
