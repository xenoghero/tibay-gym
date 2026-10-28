import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PublicRateLimiter, publicCaller } from "./public-rate-limit";

afterEach(() => vi.unstubAllEnvs());
it("isolates callers and rejects sliding-window excess with an accurate wait", () => {
  const limiter = new PublicRateLimiter();
  for (let i = 0; i < 20; i++) limiter.consume("a", "lookup", undefined, 0);
  expect(() => limiter.consume("a", "lookup", undefined, 1500)).toThrow(expect.objectContaining({
    status: 429, retryAfterSeconds: 59,
  }));
  limiter.consume("b", "lookup", undefined, 1500);
  limiter.consume("a", "lookup", undefined, 60000);
});
it("bounds scan bursts as well as sustained attendance traffic", () => {
  const limiter = new PublicRateLimiter();
  for (let i = 0; i < 3; i++) limiter.consume("a", "scan", undefined, 0);
  expect(() => limiter.consume("a", "scan", undefined, 0)).toThrow(expect.objectContaining({ retryAfterSeconds: 10 }));
  for (let i = 0; i < 7; i++) limiter.consume("a", "scan", undefined, (i + 1) * 5000 + 10000);
  expect(() => limiter.consume("a", "scan", undefined, 50000)).toThrow(expect.objectContaining({ retryAfterSeconds: 10 }));
});
it("guest limits ignore changed events/phones but allow admitted event recovery", () => {
  const limiter = new PublicRateLimiter();
  for (let i = 0; i < 3; i++) limiter.consume("a", "guest", `event-${i}`, 0);
  limiter.consume("a", "guest", "event-0", 4000);
  expect(() => limiter.consume("a", "guest", "new-phone-event", 4000)).toThrow(expect.objectContaining({ retryAfterSeconds: 896 }));
  expect(() => limiter.consume("a", "guest", "event-0", 30000)).toThrow();
  limiter.consume("b", "guest", "event-0", 4000);
  limiter.consume("a", "guest", "new-event", 900000);
});
it("enforces the daily guest budget across short-window resets", () => {
  const limiter = new PublicRateLimiter();
  for (let i = 0; i < 10; i++) limiter.consume("a", "guest", `event-${i}`, i * 900000);
  expect(() => limiter.consume("a", "guest", "event-11", 10 * 900000)).toThrow(expect.objectContaining({ retryAfterSeconds: 77400 }));
  limiter.consume("a", "guest", "next-day", 86400000);
});
it("fails closed at capacity, retains live budgets and reclaims expired entries", () => {
  const limiter = new PublicRateLimiter(1);
  limiter.consume("a", "lookup", undefined, 0);
  expect(() => limiter.consume("b", "lookup", undefined, 0)).toThrow();
  for (let i = 1; i < 20; i++) limiter.consume("a", "lookup", undefined, 0);
  expect(() => limiter.consume("a", "lookup", undefined, 0)).toThrow();
  limiter.consume("b", "lookup", undefined, 60000);
});
it("does not partially consume guest budgets when admission cannot fit", () => {
  const limiter = new PublicRateLimiter(2);
  expect(() => limiter.consume("a", "guest", "event", 0)).toThrow();
  limiter.consume("b", "lookup", undefined, 0);
  limiter.consume("c", "lookup", undefined, 0);
});
it("recounts admission space after cleanup removes an expired bucket", () => {
  const limiter = new PublicRateLimiter(3);
  limiter.consume("a", "guest", "first", 0);
  // Sweep just before the short guest window expires, delaying scheduled cleanup.
  limiter.pruneExpired(899999);
  limiter.consume("b", "lookup", undefined, 899999);
  // Cleanup frees the old short bucket, but recreating it also needs a slot.
  expect(() => limiter.consume("a", "guest", "second", 900000)).toThrow();
});
it("ignores untrusted forwarding headers and canonicalizes trusted IPs", () => {
  vi.stubEnv("VERCEL", ""); vi.stubEnv("PUBLIC_RATE_LIMIT_IP_HEADER", "");
  const request = (headers: Record<string, string>) => new Request("https://test", { headers });
  expect(publicCaller(request({ "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2" }))).toBe("unknown-caller");
  vi.stubEnv("PUBLIC_RATE_LIMIT_IP_HEADER", "x-trusted-ip");
  expect(publicCaller(request({ "x-trusted-ip": "192.0.2.1" }))).toBe("192.0.2.1");
  expect(publicCaller(request({ "x-trusted-ip": "192.0.2.1, 192.0.2.2" }))).toBe("unknown-caller");
  expect(publicCaller(request({ "x-trusted-ip": "fe80::1%eth0" }))).toBe("unknown-caller");
  expect(publicCaller(request({ "x-trusted-ip": "0:0:0:0:0:ffff:c000:201" }))).toBe("192.0.2.1");
  expect(publicCaller(request({ "x-trusted-ip": "2001:0db8:0:0:0:0:0:1" }))).toBe("2001:db8::1");
});
it("uses only the platform-controlled IP header on the current host", () => {
  vi.stubEnv("PUBLIC_RATE_LIMIT_IP_HEADER", ""); vi.stubEnv("VERCEL", "1");
  expect(publicCaller(new Request("https://test", { headers: {
    "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "192.0.2.2",
  } }))).toBe("192.0.2.1");
});
