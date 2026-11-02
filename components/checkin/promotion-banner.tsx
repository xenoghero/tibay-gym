"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PROMOTION_HEIGHT, PROMOTION_INTERVAL_MS, PROMOTION_WIDTH, type Promotion } from "@/lib/promotions";
import styles from "./promotion-banner.module.css";

type Banner = Pick<Promotion, "id" | "title" | "imageUrl">;
export function PromotionBanner() {
  const [banners, setBanners] = useState<Banner[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/promotions", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data.banners) && !controller.signal.aborted) setBanners(data.banners);
      }).catch(() => { /* Optional promotions must never block check-in or show an empty placeholder. */ });
    return () => controller.abort();
  }, []);
  return <PromotionCarousel banners={banners} />;
}

export function PromotionCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const available = banners.filter(banner => !failed.includes(banner.id));
  const count = available.length;
  const currentIndex = count ? index % count : 0;
  const rotating = count > 1 && !paused && !hovered && !focused && !hidden && !reducedMotion;

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    const updateVisibility = () => setHidden(document.hidden);
    updateMotion(); updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { motion.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => setIndex(value => (value + 1) % count), PROMOTION_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [rotating, count, index]);

  if (!count) return null;
  const current = available[currentIndex];
  return <section className={styles.banner} aria-label="Gym promotions" aria-roledescription="carousel"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className={styles.image} aria-live={rotating ? "off" : "polite"} aria-atomic="true"
      onTouchStart={event => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={event => {
        const start = touchStart.current; touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch || count < 2) return;
        const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) setIndex((currentIndex + (dx < 0 ? 1 : count - 1)) % count);
      }}>
      <div role="group" aria-roledescription="slide" aria-label={`${currentIndex + 1} of ${count}`}>
        <Image key={current.id} src={current.imageUrl} alt={current.title} width={PROMOTION_WIDTH} height={PROMOTION_HEIGHT}
          unoptimized onError={() => setFailed(value => [...value, current.id])} />
      </div>
    </div>
    {count > 1 && <div className={styles.controls}>
      <button type="button" className={styles.previous} onClick={() => setIndex((currentIndex + count - 1) % count)} aria-label="Previous promotion">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
      </button>
      <div className={styles.dots} aria-label="Choose a promotion">
        {available.map((banner, position) => <button key={banner.id} type="button" aria-label={`Show promotion ${position + 1}: ${banner.title}`}
          aria-current={position === currentIndex ? "true" : undefined} onClick={() => setIndex(position)}><span /></button>)}
      </div>
      <button type="button" className={styles.next} onClick={() => setIndex((currentIndex + 1) % count)} aria-label="Next promotion">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
      </button>
      {!reducedMotion && <button type="button" className={styles.pause} onClick={() => setPaused(value => !value)}
        aria-label={paused ? "Resume automatic promotions" : "Pause automatic promotions"}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{paused ? <path d="m8 5 11 7-11 7Z" /> : <path d="M6 5h4v14H6zm8 0h4v14h-4z" />}</svg>
      </button>}
    </div>}
  </section>;
}
