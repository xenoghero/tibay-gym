"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./entry.module.css";

export function ImageUpload({ label, file, onChange, disabled, required = false }: {
  label: string; file: File | null; onChange(file: File | null): void; disabled: boolean; required?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLImageElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) {
      if (input.current) input.current.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(next: File | null) {
    if (next && (next.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(next.type))) {
      setError("Choose a JPG, PNG or WebP image up to 5 MB.");
      if (input.current) input.current.value = "";
      onChange(null);
      return;
    }
    setError(""); onChange(next);
  }
  return <div className={styles.field}>
    <label htmlFor={id}>{label}{required ? " (required)" : ""}</label>
    <div className={styles.upload}>
      {/* Local object URLs are temporary previews, not optimized remote images. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {file && <img ref={preview} className={styles.preview} alt={`${label} preview`} />}
      <input ref={input} id={id} aria-label={label} aria-describedby={`${id}-hint ${id}-error`} type="file" accept="image/jpeg,image/png,image/webp" required={required} disabled={disabled} onChange={e => choose(e.target.files?.[0] ?? null)} />
      <p id={`${id}-hint`}>JPG, PNG or WebP · Up to 5 MB · Private upload</p>
      {file && <div className={styles.uploadActions}><button type="button" disabled={disabled} onClick={() => input.current?.click()}>Replace</button><button type="button" disabled={disabled} onClick={() => { if (input.current) input.current.value = ""; choose(null); }}>Remove</button></div>}
      <p id={`${id}-error`} role={error ? "alert" : undefined}>{error}</p>
    </div>
  </div>;
}
