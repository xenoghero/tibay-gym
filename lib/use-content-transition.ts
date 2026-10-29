"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Start before paint, and only on navigation, so data updates stay steady. */
export function useContentTransition(ref: RefObject<HTMLElement | null>, contentKey: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [{ opacity: 0.85 }, { opacity: 1 }],
      { duration: 160, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [ref, contentKey]);
}
