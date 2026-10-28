import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { ApiError } from "./rfid/http";

type Policy = { scope: string; limit: number; windowMs: number };
type Entry = { times: number[]; expiresAt: number };
const MINUTE = 60_000;
const policies = {
  lookup: [{ scope: "lookup", limit: 20, windowMs: MINUTE }],
  scan: [{ scope: "scan", limit: 10, windowMs: MINUTE },
    { scope: "scan-burst", limit: 3, windowMs: 10_000 }],
  guest: [{ scope: "guest-short", limit: 3, windowMs: 15 * MINUTE },
    { scope: "guest-day", limit: 10, windowMs: 24 * 60 * MINUTE }],
  sweep: [{ scope: "sweep", limit: 10, windowMs: MINUTE }],
  customerLogin: [{ scope: "customer-login", limit: 5, windowMs: 15 * MINUTE }],
  customer: [{ scope: "customer-action", limit: 30, windowMs: MINUTE }],
  image: [{ scope: "customer-image", limit: 5, windowMs: 15 * MINUTE }],
} satisfies Record<string, Policy[]>;

/** Best effort per process, with no database access. Never evict live budgets
 * to admit a new caller: capacity exhaustion fails closed instead. */
export class PublicRateLimiter {
  private entries = new Map<string, Entry>();
  private secret = randomBytes(32);
  private nextCleanup = 0;
  constructor(private capacity = 10_000) {}
  private key(value: string) {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }
  pruneExpired(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    this.nextCleanup = now + MINUTE;
  }
  consume(caller: string, action: keyof typeof policies, event?: string, now = Date.now()) {
    if (now >= this.nextCleanup) this.pruneExpired(now);
    // Guest retries reuse admission for 30 seconds, but still spend the scan budget.
    const replayKey = action === "guest" && event ? this.key(`retry:${caller}:${event}`) : undefined;
    if (replayKey && (this.entries.get(replayKey)?.expiresAt ?? 0) > now) return;
    const buckets = policies[action].map(policy => {
      const key = this.key(`${policy.scope}:${caller}`);
      const times = (this.entries.get(key)?.times ?? []).filter(time => time > now - policy.windowMs);
      return { ...policy, key, times };
    });
    let waitMs = 0;
    for (const bucket of buckets) if (bucket.times.length >= bucket.limit) {
      waitMs = Math.max(waitMs, bucket.times[0] + bucket.windowMs - now);
    }
    if (waitMs > 0) throw new ApiError(429, "rate-limited", Math.ceil(waitMs / 1000));
    const needed = () => buckets.filter(bucket => !this.entries.has(bucket.key)).length +
      (replayKey && !this.entries.has(replayKey) ? 1 : 0);
    if (this.entries.size + needed() > this.capacity) {
      this.pruneExpired(now);
      if (this.entries.size + needed() > this.capacity) throw new ApiError(429, "rate-limited", 60);
    }
    for (const bucket of buckets) this.entries.set(bucket.key, {
      times: [...bucket.times, now], expiresAt: now + bucket.windowMs,
    });
    if (replayKey) this.entries.set(replayKey, { times: [], expiresAt: now + 30_000 });
  }
}

/** Only trust a header overwritten by the hosting proxy. Other deployments
 * must explicitly configure their trusted proxy; arbitrary XFF is ignored. */
export function publicCaller(request: Request): string {
  const header = process.env.PUBLIC_RATE_LIMIT_IP_HEADER ||
    (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : undefined);
  const value = header ? request.headers.get(header)?.trim() : undefined;
  if (!value || value.includes("%") || !isIP(value)) return "unknown-caller";
  // Canonicalize equivalent IPv6 representations (and mapped IPv4 addresses).
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) return [parseInt(mapped[1], 16) >>> 8, parseInt(mapped[1], 16) & 255,
    parseInt(mapped[2], 16) >>> 8, parseInt(mapped[2], 16) & 255].join(".");
  return canonical;
}

// Share between route bundles within this process, including development HMR.
const shared = globalThis as typeof globalThis & {
  reshapePublicLimiter?: PublicRateLimiter;
  reshapePublicLimiterCleanup?: ReturnType<typeof setInterval>;
};
export const publicRateLimiter = shared.reshapePublicLimiter ??= new PublicRateLimiter();
shared.reshapePublicLimiterCleanup ??= setInterval(() => publicRateLimiter.pruneExpired(), MINUTE).unref();
