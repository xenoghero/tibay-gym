import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./memory-firestore";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn(),
}));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db, adminAuth: () => ({ verifyIdToken: mocks.verify }) }));
import { POST as lookup } from "@/app/api/attendance/lookup/route";
import { POST as scan } from "@/app/api/attendance/scan/route";
import { POST as sweep, GET as scheduledSweep } from "@/app/api/attendance/auto-close/route";
import { scanAttendance, STALE_SESSION_MS } from "@/lib/server/attendance";
import { fingerprint } from "@/lib/server/rfid/receipts";
import { credentialHash } from "@/lib/server/rfid/validation";
import { attendanceApi, type QrLookupResponse, type QrResponse } from "@/lib/attendance-api";
import { CheckinAttempt } from "@/lib/checkin-attempt";
import { PublicRateLimiter, publicRateLimiter } from "@/lib/server/public-rate-limit";

const NOW = 1800000000000;
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://reshape.test/api", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
let store: ReturnType<typeof memoryFirestore>;
let lostResponse: boolean;
let attempt: CheckinAttempt;
const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
const fetchLocal = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(url);
  const body = JSON.parse(String(init?.body));
  requests.push({ path, body });
  const handler = path === "/api/attendance/lookup" ? lookup : path === "/api/attendance/scan" ? scan :
    path === "/api/attendance/auto-close" ? sweep : null;
  if (!handler) throw new Error("Non-local network is forbidden in integration tests");
  const response = await handler(request(body));
  if (path.endsWith("/scan") && lostResponse && response.ok) {
    lostResponse = false;
    throw new Error("Simulated connection loss AFTER transaction commit");
  }
  return response;
});
const docs = (collection: string) => [...store.data].filter(([path]) => path.startsWith(`${collection}/`));
const writes = () => store.operations.filter(op => ["set", "update", "delete"].includes(op.kind));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks();
  const limiter = new PublicRateLimiter();
  vi.spyOn(publicRateLimiter, "consume").mockImplementation((...args) => limiter.consume(...args));
  store = memoryFirestore(); mocks.db.mockReturnValue(store.db);
  mocks.verify.mockResolvedValue({ uid: "admin-1" });
  lostResponse = false; requests.length = 0;
  vi.stubGlobal("fetch", fetchLocal);
  vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin-1"); vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  for (const method of ["info", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation(() => {});
  store.data.set("persons/p1", { phone: "09123456789", name: "Alex", type: "member", status: "active",
    membershipExpiry: Timestamp.fromMillis(NOW + 86400000), visitCount: 0, rfidTagId: "09:70:65:20" });
  store.data.set("attendanceState/p1", { openLogId: null, lastLogId: null, lastAction: null, lastAcceptedScanAt: null });
  store.data.set("_serverConfig/admin", { uid: "admin-1" });
  let eventSequence = 0;
  attempt = new CheckinAttempt({ lookup: body => attendanceApi<QrLookupResponse>("/api/attendance/lookup", body),
    scan: body => attendanceApi<QrResponse>("/api/attendance/scan", body), now: () => Date.now(),
    eventId: () => `integrated-event-${String(++eventSequence).padStart(6, "0")}`, online: () => true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it.each(["member", "guest", "expired-member"])("integrates client lookup/scan for %s without database throttle writes", async kind => {
  Object.assign(store.data.get("persons/p1")!, kind === "guest" ? { type: "guest", status: null, membershipExpiry: null }
    : kind === "expired-member" ? { status: "active", membershipExpiry: Timestamp.fromMillis(NOW - 1) } : {});
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-in", visitCount: 1 } });
  expect(docs("attendanceLogs")).toHaveLength(1); expect(docs("rfidRateLimits")).toHaveLength(0);
  expect(requests.map(row => row.path)).toEqual(["/api/attendance/lookup", "/api/attendance/scan"]);
});
it.each(["member", "guest"])("first phone check-in initializes a new admin-created %s profile", async type => {
  Object.assign(store.data.get("persons/p1")!, { type, lastVisitAt: null });
  store.data.delete("attendanceState/p1");
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-in", visitCount: 1 } });
  const logs = docs("attendanceLogs");
  expect(logs).toHaveLength(1);
  expect(store.data.get("attendanceState/p1")).toMatchObject({ openLogId: logs[0][0].split("/")[1], lastAction: "checked-in" });
});

it("missing guard with existing history still requires reconciliation even if the counter is zero", async () => {
  store.data.delete("attendanceState/p1");
  store.data.set("attendanceLogs/existing-visit", { personId: "p1", checkInAt: Timestamp.fromMillis(NOW - 60000), checkOutAt: null });
  const response = await scan(request({ personId: "p1", eventId: "existing-history-001", requestedAt: NOW }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: "attendance-not-initialized" });
  expect(writes()).toHaveLength(0);
});

it("the same phone attendance flow checks in first and checks out second without adding another visit", async () => {
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-in", visitCount: 1 } });
  expect(attempt.reset()).toBe(true);
  vi.setSystemTime(NOW + 60000);
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-out", visitCount: 1 } });
  expect(docs("attendanceLogs")).toHaveLength(1);
  expect(docs("attendanceLogs")[0][1].checkOutAt).toEqual(Timestamp.fromMillis(NOW + 60000));
  expect(store.data.get("attendanceState/p1")?.openLogId).toBeNull();
  expect(requests.filter(row => row.path.endsWith("scan")).map(row => row.body.intent)).toEqual(["attendance", "attendance"]);
});
it("new guest isolates profile, visits, and optional address until verification", async () => {
  await attempt.submitPhone("09999999999", "attendance");
  expect(attempt.getSnapshot().stage).toBe("name");
  vi.setSystemTime(NOW + 90000);
  await attempt.submitGuest("Sam", "Street", { rateCategory: "student", leadSource: "friends", leadSourceOther: null });
  expect(attempt.getSnapshot().status).toBe("confirmed");
  const id = attempt.getSnapshot().result!.personId;
  expect(store.data.get(`unverifiedPersons/${id}`)).toMatchObject({ phone: "09999999999", name: "Sam", type: "guest", visitCount: 1, address: "Street" });
  expect(store.data.has(`persons/${id}`)).toBe(false);
  expect(store.data.has(`profileDetails/${id}`)).toBe(false);
  expect(docs("attendanceLogs")).toHaveLength(0);
  expect(docs("unverifiedAttendanceLogs")).toHaveLength(1);
  expect(requests[1].body.requestedAt).toBe(NOW + 90000);
});
it("a committed but lost scan response recovers the same receipt without toggling or fingerprint conflict", async () => {
  lostResponse = true; await attempt.submitPhone("09123456789", "attendance");
  const pending = attempt.getSnapshot().pending!;
  expect(attempt.getSnapshot().status).toBe("unconfirmed");
  const receipt = docs("scanResults")[0][1];
  expect(receipt.requestFingerprint).toBe(fingerprint(["attendance-v1", "qr:attendance", "qr", "p1", pending.requestedAt]));
  const logBefore = structuredClone(docs("attendanceLogs"));
  vi.setSystemTime(NOW + 4000);
  await attempt.retry();
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-in", visitCount: 1 } });
  expect(docs("attendanceLogs")).toEqual(logBefore);
  expect(docs("scanResults")).toHaveLength(1); expect(docs("scanResults")[0][1]).toEqual(receipt);
  expect(requests[2].body).toEqual(pending);
  expect(requests.filter(row => row.path.endsWith("lookup"))).toHaveLength(1);
});
const directScan = (eventId: string, extra: Record<string, unknown> = {}) => scan(request({
  eventId, requestedAt: Date.now(), personId: "p1", ...extra,
}));
it("checkout and a lost-response retry do not open another visit", async () => {
  await directScan("open-for-checkout-0001");
  vi.setSystemTime(NOW + 30000);
  lostResponse = true;
  await attempt.submitPhone("09123456789", "checkout");
  expect(attempt.getSnapshot().status).toBe("unconfirmed");
  vi.setSystemTime(NOW + 34000); await attempt.retry();
  expect(attempt.getSnapshot()).toMatchObject({ status: "confirmed", result: { action: "checked-out", visitCount: 1 } });
  expect(docs("attendanceLogs")).toHaveLength(1);
  expect(requests.every(row => !Object.hasOwn(row.body, "location"))).toBe(true);
});
it("checkout-only never opens absent visits, and closes stale visits without incrementing counters", async () => {
  const noOpen = await directScan("checkout-no-open-0001", { intent: "checkout", expectedLogId: "old-log" });
  expect(noOpen.status).toBe(409); expect(docs("attendanceLogs")).toHaveLength(0);
  const opening = await (await directScan("open-for-stale-000001")).json();
  const log = String(store.data.get("attendanceState/p1")!.openLogId);
  vi.setSystemTime(NOW + STALE_SESSION_MS);
  const response = await directScan("stale-checkout-000001", { intent: "checkout", expectedLogId: log });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ action: "checked-out", visitCount: opening.visitCount });
  expect(docs("attendanceLogs")).toHaveLength(1); expect(store.data.get(`attendanceLogs/${log}`)?.closedReason).toBe("auto");
});
it("concurrent checkout-only requests close at most once and do not create a visit", async () => {
  await directScan("open-concurrent-00001");
  vi.setSystemTime(NOW + 30000);
  const log = store.data.get("attendanceState/p1")!.openLogId;
  const responses = await Promise.all(["checkout-concur-00001", "checkout-concur-00002"].map(id =>
    directScan(id, { intent: "checkout", expectedLogId: log })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(docs("attendanceLogs")).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
});
it("mixed QR/RFID scans share a guard, and old checkout recovery cannot close a newer RFID visit", async () => {
  const secret = "a".repeat(43);
  store.data.set("rfidDevices/entrance-01", { enabled: true, activeAssignmentId: null,
    credentialHash: credentialHash("entrance-01", secret) });
  store.data.set("rfidCards/09:70:65:20", { personId: "p1" });
  const rfid = (eventId: string) => scanAttendance({ source: "rfid", uid: "09:70:65:20", eventId,
    requestedAt: Date.now(), request: new Request("https://reshape.test/rfid", { headers: { authorization: `Bearer ${secret}` } }) });
  await Promise.all([directScan("mixed-qr-event-000001"), rfid("mixed-rfid-event-0001")]);
  expect(docs("attendanceLogs")).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
  const expectedLogId = store.data.get("attendanceState/p1")!.openLogId;
  vi.setSystemTime(NOW + 30000);
  const checkoutBody = { eventId: "checkout-old-event-01", requestedAt: Date.now(), personId: "p1", intent: "checkout", expectedLogId };
  const original = await (await scan(request(checkoutBody))).json();
  vi.setSystemTime(NOW + 60000); const newer = await rfid("newer-rfid-event-0001");
  expect(await (await scan(request(checkoutBody))).json()).toMatchObject({ action: original.action });
  const mismatch = await directScan("mismatch-event-00001", { intent: "checkout", expectedLogId });
  expect(await mismatch.json()).toEqual({ error: "checkout-session-changed" });
  expect(store.data.get("attendanceState/p1")?.openLogId).toBe(newer.logId);
  expect(store.data.get(`attendanceLogs/${newer.logId}`)?.checkOutAt).toBeNull();
  expect(docs("attendanceLogs")).toHaveLength(2); expect(store.data.get("persons/p1")?.visitCount).toBe(2);
});
it.each(["public", "admin", "scheduler"])("%s cleanup still closes a real stale guarded visit without page-load sweeps", async caller => {
  await directScan("open-for-sweep-000001"); vi.setSystemTime(NOW + STALE_SESSION_MS);
  const response = caller === "scheduler" ? await scheduledSweep(new Request("https://reshape.test/api", {
    headers: { authorization: "Bearer synthetic-cron-secret" },
  })) : await sweep(request({ caller },
    caller === "admin" ? { authorization: "Bearer synthetic-admin-token-0001" } : {}));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ closed: 1 });
  expect(store.data.get("attendanceState/p1")?.openLogId).toBeNull();
  expect(docs("attendanceLogs")[0][1].closedReason).toBe("auto"); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
});
it("attendance persists only supported fields and uses sanitized diagnostics", async () => {
  await attempt.submitPhone("09123456789", "attendance");
  const serialized = JSON.stringify([...store.data]);
  for (const field of ["location", "latitude", "longitude", "accuracyMeters", "capturedAtMs"]) {
    expect(serialized).not.toContain(`"${field}":`); expect(JSON.stringify(attempt.getSnapshot())).not.toContain(`"${field}":`);
  }
  expect(writes().every(op => /^(persons|attendanceState|attendanceLogs|scanResults|rfidRateLimits)\//.test(op.path))).toBe(true);
  for (const [line] of vi.mocked(console.info).mock.calls) {
    expect(Object.keys(JSON.parse(String(line))).sort()).toEqual(["durationMs", "failure", "metric", "operation", "status"]);
    expect(String(line)).not.toMatch(/latitude|longitude|accuracyMeters|capturedAtMs|Alex|123/);
  }
  expect(console.warn).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
});
it("unexpected database errors expose/log no SDK message or request body", async () => {
  mocks.db.mockImplementation(() => { throw new Error(`sensitive ${"private SDK details"}`); });
  const response = await scan(request({ personId: "p1", eventId: "failure-event-0000001", requestedAt: NOW }));
  expect(await response.json()).toEqual({ error: "server-unavailable" });
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/sensitive|latitude|longitude/);
  expect(console.error).not.toHaveBeenCalled();
});
