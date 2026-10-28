"use client";
import styles from "./entry.module.css";
import { ImageUpload } from "./image-upload";
import { useRef, useState } from "react";
export function OptionalPhoto({ phone }: { phone: string }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const operation = useRef<string | null>(null);
  async function upload() {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setMessage("Choose a JPG, PNG or WebP image up to 5 MB."); return; }
    setBusy(true); setMessage(""); operation.current ??= crypto.randomUUID();
    try {
      const login = await fetch("/api/customer/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
      if (!login.ok) throw new Error("Could not access the photo upload. Your registration is saved; try later.");
      const response = await fetch("/api/customer/photo", { method: "POST", headers: { "Content-Type": file.type, "x-operation-id": operation.current }, body: file });
      if (!response.ok) throw new Error("Could not save the photo. Your registration is saved; you can retry this upload.");
      setMessage("Profile photo saved privately."); setFile(null); operation.current = null;
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not upload the photo."); }
    finally { setBusy(false); }
  }
  return <details className={styles.disclosure}><summary>Add a profile photo (optional)</summary>
    <p>Your registration is saved. You can add a private profile photo.</p>
    <ImageUpload label="Optional profile photo" file={file} disabled={busy} onChange={next => { setFile(next); operation.current = null; }} />
    <div className={styles.uploadActions}><button type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? "Uploading…" : "Save optional photo"}</button></div>
    {message && <p role="status">{message}</p>}
    <details className={styles.disclosure}><summary>Photo privacy & retention</summary><p>Your current photo is kept while your profile exists. Replaced photos and photos from deleted profiles are removed during cleanup; unfinished uploads expire after 24 hours.</p></details>
  </details>;
}
