"use client";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./customer-access.module.css";
export type PhotoPosition = { x: number; y: number };
const CENTER: PhotoPosition = { x: 50, y: 50 };
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";

/** Loads the signed-in member's private photo (session cookie auth) as an object URL. */
export function useProfilePhotoUrl(hasPhoto: boolean, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPhoto) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetch("/api/images/profile", { signal: controller.signal })
      .then(async response => { if (!response.ok) return; objectUrl = URL.createObjectURL(await response.blob()); if (controller.signal.aborted) URL.revokeObjectURL(objectUrl); else setUrl(objectUrl); })
      .catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [hasPhoto, version]);
  return hasPhoto ? url : null;
}

export function MemberPhoto({ url, position, name, onEdit }: { url: string | null; position: PhotoPosition | null; name: string; onEdit(): void }) {
  const at = position ?? CENTER;
  return <div className={styles.passPhoto}>
    {/* Private object URL; next/image optimization does not apply. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url ? <img src={url} alt="Your profile photo" style={{ objectPosition: `${at.x}% ${at.y}%` }} /> : <span aria-hidden="true">{initials(name)}</span>}
    <button type="button" onClick={onEdit} aria-label={url ? "Change photo" : "Add photo"} title={url ? "Change photo" : "Add photo"}>
      <CameraIcon />
    </button>
  </div>;
}

const CameraIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></svg>;

export function PhotoEditor({ url, position, onSaved, onClose }: { url: string | null; position: PhotoPosition | null; onSaved(): Promise<void>; onClose(): void }) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState<string | null>(null);
  const [pos, setPos] = useState<PhotoPosition>(position ?? CENTER), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false), [dragging, setDragging] = useState(false);
  const operation = useRef<string | null>(null), frame = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), finished = useRef(false);
  const drag = useRef<{ px: number; py: number; start: PhotoPosition } | null>(null);
  const titleId = useId(), inputId = useId();
  const shown = preview ?? url;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const element = dialog.current!, trigger = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const finish = useCallback(() => { if (!finished.current) { finished.current = true; onClose(); } }, [onClose]);
  useEffect(() => {
    if (!closing) return;
    // Finish even if the browser skips animationend (reduced motion, hidden tab).
    const timeout = window.setTimeout(finish, 260);
    return () => window.clearTimeout(timeout);
  }, [closing, finish]);
  function requestClose() { if (!busy) setClosing(true); }
  function choose(next: File | null) {
    if (next && (next.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(next.type))) { setMessage("Choose a JPG, PNG or WebP image up to 5 MB."); return; }
    setMessage(""); setFile(next); setPreview(next ? URL.createObjectURL(next) : null); setPos(next ? CENTER : position ?? CENTER); operation.current = null;
  }
  /** Pixels the cover-fitted image overflows the frame on each axis (0 = nothing to pan). */
  function overflow() {
    const box = frame.current?.getBoundingClientRect(), img = image.current;
    if (!box || !img?.naturalWidth) return { x: 0, y: 0 };
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
    return { x: img.naturalWidth * scale - box.width, y: img.naturalHeight * scale - box.height };
  }
  function move(event: PointerEvent) {
    const d = drag.current, o = overflow(); if (!d) return;
    // Image follows the pointer, so the focal point moves the opposite way.
    setPos({ x: o.x > 1 ? clamp(d.start.x - (event.clientX - d.px) / o.x * 100) : d.start.x, y: o.y > 1 ? clamp(d.start.y - (event.clientY - d.py) / o.y * 100) : d.start.y });
  }
  function endDrag() { drag.current = null; setDragging(false); }
  function key(event: KeyboardEvent) {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    setPos(p => ({ x: clamp(p.x - step[0] * 5), y: clamp(p.y - step[1] * 5) }));
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      if (file) {
        operation.current ??= crypto.randomUUID();
        const uploaded = await fetch("/api/customer/photo", { method: "POST", headers: { "Content-Type": file.type, "x-operation-id": operation.current }, body: file });
        if (!uploaded.ok) throw new Error(uploaded.status === 429 ? "Too many uploads. Please wait a few minutes." : "Could not save the photo. Please try again.");
      }
      const placed = await fetch("/api/customer/photo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pos) });
      if (!placed.ok) throw new Error("Photo saved, but its position could not be saved. Please try again.");
      await onSaved();
      setClosing(true);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save the photo."); }
    finally { setBusy(false); }
  }
  const moved = pos.x !== 50 || pos.y !== 50;
  return <dialog ref={dialog} className={styles.photoModal} aria-labelledby={titleId} data-closing={closing}
    onCancel={event => { event.preventDefault(); requestClose(); }}
    onClick={event => { if (event.target === event.currentTarget) requestClose(); }}
    onAnimationEnd={event => { if (closing && event.target === event.currentTarget) finish(); }}>
    <div className={styles.photoModalInner} inert={closing}>
      <header className={styles.photoModalHead}>
        <div><span>Membership card</span><h2 id={titleId}>Profile photo</h2></div>
        <button type="button" aria-label="Close" disabled={busy} onClick={requestClose}>✕</button>
      </header>
      {shown ? <div ref={frame} className={styles.photoFrame} data-dragging={dragging} tabIndex={0} role="group" aria-label="Photo position. Drag or use the arrow keys to move it."
        onKeyDown={key} onPointerMove={move} onPointerUp={endDrag} onPointerCancel={endDrag}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { px: event.clientX, py: event.clientY, start: pos }; setDragging(true); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} src={shown} alt="" draggable={false} style={{ objectPosition: `${pos.x}% ${pos.y}%` }} />
        <span className={styles.photoHint} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3" /></svg>Drag to reposition</span>
      </div> : <label htmlFor={inputId} className={`${styles.photoFrame} ${styles.photoEmpty}`}><CameraIcon /><strong>Add a photo</strong><small>Shown on your membership card</small></label>}
      <div className={styles.photoTools}>
        <label className={styles.photoUpload} data-disabled={busy}>
          <CameraIcon />{shown ? "Upload new photo" : "Choose photo"}
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </label>
        {shown && moved && <button type="button" className={styles.photoReset} disabled={busy} onClick={() => setPos(CENTER)}>Re-center</button>}
      </div>
      <p className={styles.photoNote}>{file ? `New photo selected · ${file.name}` : "JPG, PNG or WebP · up to 5 MB · Only you and gym staff can see it"}</p>
      {message && <p className={styles.error} role="status">{message}</p>}
      <footer className={styles.photoModalFoot}>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={requestClose}>Cancel</button>
        <button type="button" className={styles.primaryButton} disabled={busy || !shown} onClick={() => void save()}>{busy ? "Saving…" : "Save photo"}</button>
      </footer>
    </div>
  </dialog>;
}
