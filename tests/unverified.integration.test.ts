import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./memory-firestore";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: mocks.db, adminAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock("@/lib/server/rfid/rate-limit", () => ({ throttle: vi.fn() }));
vi.mock("@/lib/server/public-rate-limit", () => ({ publicCaller: () => "test", publicRateLimiter: { consume: vi.fn() } }));
import { POST as scan } from "@/app/api/attendance/scan/route";
import { POST as lookup } from "@/app/api/attendance/lookup/route";
import { POST as review } from "@/app/api/attendance/unverified/route";
import { approveUnverified, deleteUnverified } from "@/lib/server/unverified";
import { STALE_SESSION_MS } from "@/lib/server/attendance";

const NOW = 1_800_000_000_000;
const token = "synthetic-admin-token-0001";
let store: ReturnType<typeof memoryFirestore>;
let sequence = 0;
const event = () => ({ eventId: `unverified-event-${String(++sequence).padStart(6, "0")}`, requestedAt: Date.now() });
const req = (body: unknown, auth?: string) => new Request("https://reshape.test/api", { method: "POST",
  headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
const rows = (name: string) => [...store.data].filter(([path]) => path.startsWith(`${name}/`));
async function register(phone = "09999999999") {
  const body = { ...event(), guest: { rateCategory: "student", leadSource: "friends", phone, name: "New guest", address: "Private address" } };
  const response = await scan(req(body));
  expect(response.status).toBe(200);
  const result = await response.json();
  return { body, result, id: result.personId as string };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); sequence = 0;
  vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin");
  store = memoryFirestore(); mocks.db.mockReturnValue(store.db);
  store.data.set("_serverConfig/admin", { uid: "admin" });
  mocks.verify.mockImplementation(async value => { if (value !== token) throw new Error("invalid"); return { uid: "admin" }; });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("keeps returning guest scans, checkout, cooldown, and retries entirely pending", async () => {
  const { id, body, result } = await register();
  expect(result).toMatchObject({ unverified: true, visitCount: 1 });
  const found = await (await lookup(req({ phone: "09999999999" }))).json();
  expect(found.person).toMatchObject({ id, unverified: true, visitCount: 1 });
  expect(found.person).not.toHaveProperty("address");
  expect(await (await scan(req(body))).json()).toEqual(result);
  vi.setSystemTime(NOW + 4_000);
  expect((await scan(req({ ...event(), personId: id }))).status).toBe(429);
  vi.setSystemTime(NOW + 30_000);
  const checkout = await (await lookup(req({ phone: "09999999999", intent: "checkout" }))).json();
  expect(checkout.expectedLogId).toBe(rows("unverifiedAttendanceLogs")[0][0].split("/")[1]);
  expect(await (await scan(req({ ...event(), personId: id, intent: "checkout", expectedLogId: checkout.expectedLogId }))).json())
    .toMatchObject({ action: "checked-out", unverified: true, visitCount: 1 });
  vi.setSystemTime(NOW + 60_000);
  expect(await (await scan(req({ ...event(), personId: id }))).json()).toMatchObject({ action: "checked-in", visitCount: 2 });
  expect(rows("unverifiedAttendanceLogs")).toHaveLength(2);
  expect(rows("persons")).toHaveLength(0); expect(rows("attendanceLogs")).toHaveLength(0);
});

it("approves all history and address with unchanged IDs/dates and preserves the open visit", async () => {
  const { id } = await register();
  vi.setSystemTime(NOW + 30_000);
  await scan(req({ ...event(), personId: id }));
  vi.setSystemTime(NOW + 60_000);
  const lastRequest = { ...event(), personId: id };
  await scan(req(lastRequest));
  const before = rows("unverifiedAttendanceLogs");
  store.data.get(`unverifiedPersons/${id}`)!.profileImagePath = "private-photo-path";
  const state = store.data.get(`unverifiedAttendanceState/${id}`)!;
  expect(await (await review(req({ operation: "approve", personIds: [id] }, token))).json()).toEqual({ results: [{ personId: id, ok: true }] });
  expect(store.data.get(`persons/${id}`)).toMatchObject({ name: "New guest", type: "guest", visitCount: 2,
    rateCategory: "student", leadSource: "friends", profileImagePath: "private-photo-path",
    createdAt: Timestamp.fromMillis(NOW), lastVisitAt: Timestamp.fromMillis(NOW + 60_000), verifiedBy: "admin" });
  expect(store.data.get(`persons/${id}`)).not.toHaveProperty("address");
  expect(store.data.get(`profileDetails/${id}`)).toMatchObject({ address: "Private address" });
  expect(store.data.get(`attendanceState/${id}`)).toMatchObject(state);
  for (const [path, data] of before) expect(store.data.get(path.replace("unverifiedAttendanceLogs", "attendanceLogs"))).toEqual(data);
  expect(rows("unverifiedPersons")).toHaveLength(0); expect(rows("unverifiedAttendanceLogs")).toHaveLength(0);
  expect(rows("unverifiedAttendanceState")).toHaveLength(0);
  // Lost scan/approval responses can be retried across approval without adding a visit.
  expect(await (await scan(req(lastRequest))).json()).toMatchObject({ action: "checked-in", visitCount: 2 });
  await approveUnverified(id, "admin"); expect(rows("attendanceLogs")).toHaveLength(2);
  const official = await (await lookup(req({ phone: "09999999999" }))).json();
  expect(official.person).not.toHaveProperty("unverified");
  vi.setSystemTime(NOW + 90_000);
  expect(await (await scan(req({ ...event(), personId: id }))).json()).toMatchObject({ action: "checked-out", visitCount: 2 });
});

it("moves more than 500 historical visits without truncation and closes a stale open visit", async () => {
  const { id } = await register();
  for (let i = 0; i < 600; i++) store.data.set(`unverifiedAttendanceLogs/older-${i}`, {
    personId: id, source: "qr", checkInAt: Timestamp.fromMillis(NOW - (i + 1) * 86_400_000),
    checkOutAt: Timestamp.fromMillis(NOW - (i + 1) * 86_400_000 + 1000), closedReason: "implicit",
  });
  vi.setSystemTime(NOW + STALE_SESSION_MS);
  await approveUnverified(id, "admin");
  expect(rows("attendanceLogs")).toHaveLength(601);
  expect(store.data.get(`persons/${id}`)?.visitCount).toBe(601);
  expect(store.data.get(`attendanceState/${id}`)?.openLogId).toBeNull();
  expect(rows("attendanceLogs").every(([, data]) => data.checkOutAt !== null)).toBe(true);
});

it("deletes individually or in bulk, cleans receipts/history/guards, and allows re-registration", async () => {
  const first = await register(); const second = await register("09888888888");
  const response = await review(req({ operation: "delete", personIds: [first.id, second.id] }, token));
  expect((await response.json()).results.every((result: { ok: boolean }) => result.ok)).toBe(true);
  for (const name of ["unverifiedPersons", "unverifiedAttendanceLogs", "unverifiedAttendanceState", "scanResults"]) expect(rows(name)).toHaveLength(0);
  const again = await register(); expect(again.id).not.toBe(first.id);
  await deleteUnverified(again.id); await deleteUnverified(again.id);
  expect(rows("unverifiedPersons")).toHaveLength(0);
});

it("serializes approval with scanning and deletion without losing or resurrecting records", async () => {
  const { id } = await register(); vi.setSystemTime(NOW + 30_000);
  await Promise.all([approveUnverified(id, "admin"), scan(req({ ...event(), personId: id }))]);
  expect(rows("attendanceLogs")).toHaveLength(1);
  expect(rows("attendanceLogs")[0][1].checkOutAt).toEqual(Timestamp.fromMillis(NOW + 30_000));
  await deleteUnverified(id); expect(store.data.has(`persons/${id}`)).toBe(true);
  const other = await register("09888888888");
  await Promise.all([deleteUnverified(other.id), expect(approveUnverified(other.id, "admin")).rejects.toMatchObject({ code: "registration-deleting" })]);
  expect(store.data.has(`persons/${other.id}`)).toBe(false);
  expect(store.data.has(`unverifiedPersons/${other.id}`)).toBe(false);
});

it("resumes failed deletion while scans and approval stay blocked", async () => {
  const { id } = await register();
  const batch = vi.spyOn(store.db, "batch").mockImplementationOnce(() => { throw new Error("temporary failure"); });
  await expect(deleteUnverified(id)).rejects.toThrow("temporary failure");
  expect(store.data.get(`unverifiedPersons/${id}`)?.deletingAt).toBeTruthy();
  expect((await scan(req({ ...event(), personId: id }))).status).toBe(409);
  await expect(approveUnverified(id, "admin")).rejects.toMatchObject({ code: "registration-deleting" });
  batch.mockRestore(); await deleteUnverified(id);
  expect(rows("unverifiedPersons")).toHaveLength(0); expect(rows("unverifiedAttendanceLogs")).toHaveLength(0);
});

it("rejects duplicate phones in either namespace and does not overwrite an official profile", async () => {
  const { id } = await register();
  expect((await scan(req({ ...event(), guest: { rateCategory: "student", leadSource: "friends", phone: "09999999999", name: "Duplicate" } }))).status).toBe(409);
  store.data.set("persons/admin-created", { phone: "09999999999", name: "Official" });
  await expect(approveUnverified(id, "admin")).rejects.toMatchObject({ code: "registration-conflict" });
  expect(rows("attendanceLogs")).toHaveLength(0);
  expect(store.data.has(`unverifiedPersons/${id}`)).toBe(true);
  expect((await scan(req({ ...event(), guest: { rateCategory: "student", leadSource: "friends", phone: "09999999999", name: "Duplicate" } }))).status).toBe(409);
});

it.each([undefined, "forged-token-0000000000000"])("denies unauthenticated review before any mutation (%s)", async auth => {
  const response = await review(req({ operation: "delete", personIds: ["p1"] }, auth));
  expect(response.status).toBe(401);
  expect(store.operations.some(op => ["set", "update", "delete"].includes(op.kind))).toBe(false);
});
it("denies a signed-in non-admin and validates bulk requests before any mutation", async () => {
  mocks.verify.mockResolvedValueOnce({ uid: "someone-else" });
  expect((await review(req({ operation: "approve", personIds: ["p1"] }, token))).status).toBe(403);
  for (const body of [ { operation: "delete", personIds: [] }, { operation: "delete", personIds: Array(51).fill("p1") },
    { operation: "approve", personIds: ["p1", "p2"] }, { operation: "delete", personIds: ["../p1"] },
    { operation: "delete", personIds: ["p1"], extra: true } ]) {
    expect((await review(req(body, token))).status).toBe(400);
  }
  expect(store.operations.some(op => ["set", "update", "delete"].includes(op.kind))).toBe(false);
});

it("reports partial bulk failures individually so the admin can retry unfinished deletions", async () => {
  const first = await register(); const second = await register("09888888888");
  vi.spyOn(store.db, "batch").mockImplementationOnce(() => { throw new Error("temporary failure"); });
  const response = await review(req({ operation: "delete", personIds: [first.id, second.id] }, token));
  expect(await response.json()).toEqual({ results: [
    { personId: first.id, ok: false, error: "server-unavailable" }, { personId: second.id, ok: true },
  ] });
  expect(store.data.get(`unverifiedPersons/${first.id}`)?.deletingAt).toBeTruthy();
  expect(store.data.has(`unverifiedPersons/${second.id}`)).toBe(false);
  await deleteUnverified(first.id); expect(rows("unverifiedPersons")).toHaveLength(0);
});
