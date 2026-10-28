"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Small FIFO toast queue. Views that used a single `useState<string | null>`
 * for a flash message would silently clobber one toast with the next if two
 * async actions finished close together (UX Gap Audit — "Toast/flash state is
 * a single reused string per view"). This shows one at a time, queuing the
 * rest instead of dropping them.
 */
export function useToastQueue(durationMs = 2800) {
  const [queue, setQueue] = useState<string[]>([]);
  const timerRef = useRef<number | null>(null);

  const push = useCallback((text: string) => {
    setQueue((prev) => [...prev, text]);
  }, []);

  useEffect(() => {
    if (queue.length === 0 || timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setQueue((prev) => prev.slice(1));
    }, durationMs);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [queue, durationMs]);

  return { current: queue[0] ?? null, push };
}
