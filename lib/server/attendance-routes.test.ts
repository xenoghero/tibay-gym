import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  db: vi.fn(), verify: vi.fn(), throttle: vi.fn(), publicLimit: vi.fn(), scan: vi.fn(), sweep: vi.fn(),
  person: {} as Record<string, unknown>, found: true,
  docs: new Map<string, Record<string, unknown>>(), query: vi.fn(),
}));
vi.mock("./firebase-admin", () => ({ adminDb: mocks.db, adminAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock("./rfid/rate-limit", () => ({ throttle: mocks.throttle }));
vi.mock("./public-rate-limit", () => ({ publicCaller: () => "test-caller", publicRateLimiter: { consume: mocks.publicLimit } }));
vi.mock("./attendance", () => ({ scanAttendance: mocks.scan }));
vi.mock("./attendance-admin", () => ({ sweepStaleSessions: mocks.sweep }));
import { POST as lookup } from "@/app/api/attendance/lookup/route";
import { POST as scan } from "@/app/api/attendance/scan/route";
import { POST as sweep, GET as scheduledSweep } from "@/app/api/attendance/auto-close/route";
const now = 1_800_000_000_000;
const goodToken = "good-token-01234567890123";
const stamp = (n: number) => ({ toMillis: () => n });
const event = () => ({ personId: "p1", eventId: "event-012345678901", requestedAt: now });
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://reshape.test/api", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.publicLimit.mockReset();
  vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin1"); vi.stubEnv("CRON_SECRET", "test-cron-secret");
  mocks.found = true;
  mocks.person = { name: "Member", type: "member", status: "active", membershipExpiry: stamp(now + 1000), visitCount: 3,
    phone: "09123456789", address: "private", birthDate: "private", rfidTagId: "private", credentialHash: "secret" };
  mocks.docs = new Map([
    ["persons/p1", mocks.person], ["attendanceLogs/l1", { checkInAt: stamp(now - 5000) }],
    ["attendanceState/p1", { openLogId: "l1" }], ["_serverConfig/admin", { uid: "admin1" }],
  ]);
  mocks.query.mockImplementation(() => ({ limit: () => ({ get: async () => ({ empty: !mocks.found,
    docs: mocks.found ? [{ id: "p1", data: () => mocks.person }] : [] }) }) }));
  mocks.db.mockImplementation(() => ({ collection: () => ({ where: mocks.query }),
    runTransaction: async (work: (tx: { get: (ref: { get: () => unknown }) => unknown }) => unknown) => work({ get: ref => ref.get() }),
    doc: (path: string) => ({ get: async () => ({ data: () => mocks.docs.get(path) }) }) }));
  mocks.verify.mockImplementation(async token => {
    if (token !== goodToken) throw new Error("forged");
    return { uid: "admin1" };
  });
  mocks.scan.mockResolvedValue({ action: "checked-in", logId: "l1", resultCode: "checked-in" });
  mocks.sweep.mockResolvedValue(1);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
function noFirebase() {
  for (const fn of [mocks.db, mocks.verify, mocks.throttle, mocks.scan, mocks.sweep]) expect(fn).not.toHaveBeenCalled();
}
it.each(["", "0912345678", "091234567890", "0912345678a", "+9123456789", "09123 56789", " 09123456789 ", "０９１２３４５６７８９", 9123456789, null])(
  "lookup and guest scan reject invalid phone %j before Firebase", async phone => {
    expect((await lookup(request({ phone }))).status).toBe(400);
    expect((await scan(request({ eventId: event().eventId, requestedAt: now, guest: { rateCategory: "student", leadSource: "friends", phone, name: "Guest" } }))).status).toBe(400);
    noFirebase();
  },
);
const publicRoutes = [
  { name: "lookup", handler: lookup, body: () => ({ phone: "09123456789" }) },
  { name: "scan", handler: scan, body: event },
  { name: "sweep", handler: sweep, body: () => ({ caller: "public" }) },
];
for (const route of publicRoutes) {
  it(`${route.name} accepts requests without device position`, async () => {
    const response = await route.handler(request(route.body()));
    expect(response.status).toBe(200);
    expect(mocks.publicLimit).toHaveBeenCalled();
  });
  it(`${route.name} bounds streamed bodies before Firebase`, async () => {
    const response = await route.handler(request({ ...route.body(), padding: "x".repeat(4100) }));
    expect(response.status).toBe(413); noFirebase();
  });
}
it("lookup preserves exact phone matching and allowlists the person response", async () => {
  const response = await lookup(request({ phone: "09123456789" }));
  expect(response.status).toBe(200);
  expect(mocks.query).toHaveBeenCalledWith("phone", "==", "09123456789");
  expect(await response.json()).toEqual({ person: { id: "p1", name: "Member", type: "member", status: "active",
    membershipExpiryMs: now + 1000, visitCount: 3 } });
  expect(mocks.publicLimit).toHaveBeenCalledWith("test-caller", "lookup");
});
it("lookup returns no match and rejects deleted people without leaking their fields", async () => {
  mocks.found = false;
  expect(await (await lookup(request({ phone: "09123456789" }))).json()).toEqual({ person: null });
  mocks.found = true; mocks.person.deletingAt = stamp(now);
  expect((await lookup(request({ phone: "09123456789" }))).status).toBe(409);
});
it("checkout-only lookup is supplies an expected session", async () => {
  expect(await (await lookup(request({ phone: "09123456789", intent: "checkout" }))).json()).toMatchObject({
    person: { id: "p1" }, expectedLogId: "l1",
  });
  expect(mocks.publicLimit).toHaveBeenCalledWith("test-caller", "lookup");
});
it("scan forwards the same identity on retry", async () => {
  const body = event();
  expect((await scan(request({ ...body }))).status).toBe(200);
  expect((await scan(request(body))).status).toBe(200);
  const [first, second] = mocks.scan.mock.calls.map(call => call[0]);
  expect(first).toEqual(second); expect(first).toEqual({ ...body, source: "qr", guest: undefined });
  expect(first).not.toHaveProperty("location");
});
it("guest scan preserves name/phone/optional address", async () => {
  const body = { eventId: event().eventId, requestedAt: now, guest: { rateCategory: "student", leadSource: "friends", leadSourceOther: null, phone: "09123456789", name: " Guest ", address: " Address " } };
  mocks.scan.mockResolvedValue({ action: null, resultCode: "guest-conflict" });
  expect((await scan(request({ ...body }))).status).toBe(409);
  expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ guest: { rateCategory: "student", leadSource: "friends", leadSourceOther: null, phone: "09123456789", name: "Guest", address: "Address" } }));
});
it("checkout-only scan forwards intent/expected log explicitly", async () => {
  mocks.scan.mockResolvedValue({ action: "checked-out", logId: "l1", resultCode: "checked-out" });
  const response = await scan(request({ ...event(), intent: "checkout", expectedLogId: "l1" }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ action: "checked-out" });
  expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({ intent: "checkout", expectedLogId: "l1" }));
});
it.each([
  { intent: "checkout" }, { intent: "checkout", expectedLogId: "l1", guest: { rateCategory: "student", leadSource: "friends", leadSourceOther: null, phone: "09123456789", name: "X" } },
  { intent: "admin" }, { requestedAt: Infinity }, { expectedLogId: "l1" },
])("invalid checkout/identity fields cannot bypass the gate %#", async overrides => {
  const response = await scan(request({ ...event(), ...overrides })); expect(response.status).toBe(400); noFirebase();
});
it("accepted public sweep throttles and closes stale sessions", async () => {
  const response = await sweep(request({ caller: "public" }));
  expect(await response.json()).toEqual({ closed: 1 });
  expect(mocks.publicLimit).toHaveBeenCalledWith("public-sweep", "sweep"); expect(mocks.sweep).toHaveBeenCalledOnce();
});
it("admin cleanup verifies the token and configured admin before cleanup", async () => {
  const response = await sweep(request({ caller: "admin" }, { authorization: `Bearer ${goodToken}` }));
  expect(response.status).toBe(200); expect(mocks.verify).toHaveBeenCalledWith(goodToken, true);
  expect(mocks.sweep).toHaveBeenCalledOnce();
});
it.each([undefined, "Bearer forged-token-01234567890"])("forged/missing admin credentials never reach cleanup %#", async authorization => {
  const response = await sweep(request({ caller: "admin" }, authorization ? { authorization } : {}));
  expect(response.status).toBe(401); expect(mocks.sweep).not.toHaveBeenCalled();
  expect(mocks.throttle).not.toHaveBeenCalledWith("attendance-sweep", 10);
});
it("a valid non-admin token does not bypass cleanup authorization", async () => {
  mocks.verify.mockResolvedValue({ uid: "not-admin" });
  expect((await sweep(request({ caller: "admin" }, { authorization: `Bearer ${goodToken}` }))).status).toBe(403);
  expect(mocks.sweep).not.toHaveBeenCalled();
});
it("scheduler cleanup requires its configured secret", async () => {
  expect((await scheduledSweep(new Request("https://reshape.test/api"))).status).toBe(401); noFirebase();
  expect((await scheduledSweep(new Request("https://reshape.test/api", { headers: { authorization: "Bearer test-cron-secret" } }))).status).toBe(200);
  expect(mocks.sweep).toHaveBeenCalledOnce();
});

import { ApiError } from "./rfid/http";
it.each(publicRoutes)("$name rejects limited traffic before any database work", async route => {
  mocks.publicLimit.mockImplementation(() => { throw new ApiError(429, "rate-limited", 24); });
  const response = await route.handler(request(route.body()));
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("24");
  expect(await response.json()).toEqual({ error: "rate-limited", retryAfterSeconds: 24 });
  noFirebase();
});
it("guest creation budget is checked before scan/database work", async () => {
  mocks.publicLimit.mockImplementation((_caller, action) => {
    if (action === "guest") throw new ApiError(429, "rate-limited", 900);
  });
  const response = await scan(request({ eventId: event().eventId, requestedAt: now,
    guest: { rateCategory: "student", leadSource: "friends", leadSourceOther: null, phone: "09123456789", name: "Guest" } }));
  expect(response.status).toBe(429); noFirebase();
});
