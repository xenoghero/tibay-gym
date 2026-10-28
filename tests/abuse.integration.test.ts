import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "./memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db }));
import { POST as scan } from "@/app/api/attendance/scan/route";
import { POST as lookup } from "@/app/api/attendance/lookup/route";
import { PublicRateLimiter, publicRateLimiter } from "@/lib/server/public-rate-limit";

const NOW = 1800000000000;
let store: ReturnType<typeof memoryFirestore>;
const request = (body: unknown, index = 0) => new Request("http://127.0.0.1/api", {
  method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `192.0.2.${index + 1}`,
    "x-real-ip": `198.51.100.${index + 1}`, "x-vercel-forwarded-for": `203.0.113.${index + 1}` },
  body: JSON.stringify(body),
});
const guest = (index: number) => ({ eventId: `abuse-guest-event-${index.toString().padStart(6, "0")}`,
  requestedAt: Date.now(), guest: { rateCategory: "regular", leadSource: "ads", phone: `09${index.toString().padStart(9, "0")}`, name: `Test guest ${index}`, address: "" } });
const persons = () => [...store.data.keys()].filter(path => path.startsWith("unverifiedPersons/"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubEnv("VERCEL", ""); vi.stubEnv("PUBLIC_RATE_LIMIT_IP_HEADER", "");
  store = memoryFirestore(); mocks.db.mockReturnValue(store.db);
  const limiter = new PublicRateLimiter();
  vi.spyOn(publicRateLimiter, "consume").mockImplementation((...args) => limiter.consume(...args));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("rotating phones, event IDs and untrusted IP headers cannot bypass guest creation limits", async () => {
  for (let i = 0; i < 3; i++) {
    vi.setSystemTime(NOW + i * 11000);
    expect((await scan(request(guest(i), i))).status).toBe(200);
  }
  vi.setSystemTime(NOW + 33000);
  const operations = store.operations.length;
  const response = await scan(request(guest(4), 4));
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "rate-limited", retryAfterSeconds: 867 });
  expect(store.operations).toHaveLength(operations);
  expect(persons()).toHaveLength(3);
  expect([...store.data.keys()].some(path => path.startsWith("rfidRateLimits/"))).toBe(false);
});
it("an admitted guest recovers after guest-budget exhaustion without creating a fourth person", async () => {
  let pending = guest(0);
  let original: unknown;
  for (let i = 0; i < 3; i++) {
    vi.setSystemTime(NOW + i * 11000);
    const body = guest(i);
    const response = await scan(request(body, i));
    expect(response.status).toBe(200);
    if (i === 2) { pending = body; original = await response.json(); }
  }
  vi.setSystemTime(NOW + 33000);
  expect((await scan(request(guest(3), 3))).status).toBe(429);
  const recovered = await scan(request(pending, 4));
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual(original);
  expect(persons()).toHaveLength(3);
  expect([...store.data.keys()].filter(path => path.startsWith("unverifiedAttendanceLogs/"))).toHaveLength(3);
  expect([...store.data.keys()].filter(path => path.startsWith("persons/") || path.startsWith("attendanceLogs/"))).toHaveLength(0);
});
it("concurrent malformed lookup floods are bounded before any database work despite spoofed headers", async () => {
  const responses = await Promise.all(Array.from({ length: 64 }, (_, i) => lookup(request({ phone: "invalid" }, i))));
  expect(responses.filter(response => response.status === 400)).toHaveLength(20);
  expect(responses.filter(response => response.status === 429)).toHaveLength(44);
  expect(store.operations).toHaveLength(0);
  expect(mocks.db).not.toHaveBeenCalled();
});
