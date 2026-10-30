"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import styles from "./payment-review.module.css";

export function ReceiptImage({ receiptId, alt = "Private GCash receipt" }: { receiptId: string; alt?: string }) {
  const { user } = useAuth();
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true, objectUrl: string | null = null;
    const controller = new AbortController();
    void user.getIdToken().then(async token => {
      const response = await fetch(`/api/receipts/image?id=${encodeURIComponent(receiptId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error("receipt-image-unavailable");
      const blob = await response.blob();
      if (active) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl); }
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user, receiptId, attempt]);

  return <div className={styles.receiptImageFrame} role="group" aria-label="Receipt image" aria-busy={status === "loading"}>
    {image && status !== "error" && <Image key={image} src={image} alt={alt} width={500} height={650} unoptimized loading="eager"
      className={styles.receiptImage} data-ready={status === "ready"} aria-hidden={status !== "ready"}
      onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />}
    {status !== "ready" && <div className={styles.receiptImagePlaceholder}>
      {status === "error" && <svg width="48" height="60" viewBox="0 0 48 60" fill="none" aria-hidden="true"><path d="M9 3h21l9 9v43l-5-3-5 3-5-3-5 3-5-3-5 3V3Z" stroke="currentColor" strokeWidth="1.5" /><path d="M29 3v11h10M16 24h16M16 31h16M16 38h10" stroke="currentColor" strokeWidth="1.5" /></svg>}
      {status === "loading" ? <LoadingSkeleton label="Loading receipt image…" variant="image" count={4} /> :
        <div role="status" className={styles.receiptImageProgress}><strong>Receipt image unavailable</strong><span>We couldn’t load the image. Try again.</span><button onClick={() => { setImage(null); setStatus("loading"); setAttempt(value => value + 1); }}>Retry image</button></div>}
    </div>}
  </div>;
}
