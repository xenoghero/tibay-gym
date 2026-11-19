import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof import("@/tests/memory-firestore").memoryFirestore> | null, tokens: new Map<string, string>() }));
vi.mock("./firebase-admin", () => ({
  adminDb: () => mocks.store!.db,
  adminAuth: () => ({ verifyIdToken: async (token: string) => { const uid = mocks.tokens.get(token); if (!uid) throw new Error("forged"); return { uid }; } }),
}));
vi.mock("./rfid/rate-limit", () => ({ throttle: async () => {} }));
import { GET as schedule, POST as bookings } from "@/app/api/coach/bookings/route";
import { POST as sessions } from "@/app/api/coach/sessions/route";
import { GET as adminSchedule, POST as adminBookings } from "@/app/api/admin/coach-bookings/route";

// Tuesday, Nov 17 2026, 10:00 AM in Manila.
const NOW = Date.parse("2026-11-17T02:00:00Z");
const token = (uid: string) => { const value = `token-${uid}-0123456789abcdef`; mocks.tokens.set(value, uid); return value; };
const call = (handler: (request: Request) => Promise<Response>, uid: string, body?: unknown, query = "") => handler(new Request(`https://tibay.test/api${query}`, {
  method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token(uid)}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const result = async (response: Response) => [response.status, (await response.json()).error];
const book = (extra: Record<string, unknown>) => call(bookings, "coach1", { action: "book", personId: "c1", date: "2026-11-19", hour: 16, ...extra });
const seedClient = (id: string, coachId: string, sessionsUsed = 2) => {
  mocks.store!.data.set(`persons/${id}`, { name: `Client ${id}`, phone: "09123456789", type: "member", status: "active",
    coachingProfile: { fbName: id, goals: null, startDate: "2026-11-01", preferredSchedule: { weekdays: ["thu"], timeSlot: "afternoon" }, remarks: null } });
  mocks.store!.data.set(`coachingPackages/pkg-${id}`, { id: `pkg-${id}`, personId: id, chargeId: id, paymentRequestId: "r", packageId: "pkg-8", priceMinor: 1, sessions: 8,
    validityDays: 30, status: "active", submittedAt: NOW - 1000, approvedAt: NOW - 900, startedAt: NOW - 800, coachingExpiresAt: Date.parse("2026-12-18T00:00:00+08:00"), sessionsUsed, topUpSessions: 0 });
  mocks.store!.data.set(`coachAssignments/${id}`, { personId: id, coachId, assignedAt: NOW, assignedBy: "admin1" });
};
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin1");
  mocks.store = memoryFirestore(); mocks.tokens.clear();
  for (const id of ["coach1", "coach2"]) mocks.store.data.set(`coaches/${id}`, { name: id, email: `${id}@example.com`, active: true, createdAt: NOW, deactivatedAt: null });
  seedClient("c1", "coach1"); seedClient("c2", "coach2");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("books an assigned client, weekly when asked, and refuses clashes, past hours and more bookings than sessions", async () => {
  expect((await book({})).status).toBe(200);
  expect(await result(await book({}))).toEqual([409, "time-taken"]);
  expect(await result(await book({ date: "2026-11-17", hour: 10 }))).toEqual([400, "booking-in-past"]);
  expect(await result(await book({ hour: 22 }))).toEqual([400, "invalid-booking-hour"]);
  expect(await result(await book({ personId: "c2" }))).toEqual([403, "client-not-assigned"]);
  expect(await result(await book({ date: "2026-11-20", weeks: 5 }))).toEqual([409, "after-coaching-expiry"]);
  // 6 sessions left, 1 already booked: 5 more fit, 6 do not.
  mocks.store!.data.set("coachingPackages/pkg-c1", { ...mocks.store!.data.get("coachingPackages/pkg-c1"), coachingExpiresAt: Date.parse("2027-02-01T00:00:00+08:00") });
  expect(await result(await book({ date: "2026-11-20", weeks: 6 }))).toEqual([409, "not-enough-sessions"]);
  const series = await (await book({ date: "2026-11-20", weeks: 5 })).json();
  expect(series.ids).toHaveLength(5);
  const saved = [...mocks.store!.data].filter(([path]) => path.startsWith("coachBookings/")).map(([, row]) => row);
  expect(saved.filter(row => row.seriesId).map(row => row.date)).toEqual(["2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18"]);
  expect(await result(await book({ date: "2026-11-21" }))).toEqual([409, "not-enough-sessions"]);
});

it("lists the coach's own bookings with upcoming counts and who needs a booking this week", async () => {
  seedClient("c3", "coach1");
  await book({});
  await call(bookings, "coach2", { action: "book", personId: "c2", date: "2026-11-19", hour: 16 });
  const body = await (await call(schedule, "coach1", undefined, "?from=2026-11-15&to=2026-11-21")).json();
  expect(body).toMatchObject({ today: "2026-11-17", hourNow: 10 });
  expect(body.bookings).toEqual([expect.objectContaining({ personId: "c1", date: "2026-11-19", hour: 16, mark: null })]);
  expect(body.clients.map((c: { id: string; booked: number; needsBooking: boolean }) => [c.id, c.booked, c.needsBooking])).toEqual([["c1", 1, false], ["c3", 0, true]]);
  expect(body.clients[0].next).toEqual({ date: "2026-11-19", hour: 16, coachId: "coach1" });
  expect(body.clients[1].next).toBeNull();
  expect(await result(await call(schedule, "coach1", undefined, "?from=2026-11-01&to=2027-01-15"))).toEqual([400, "invalid-range"]);
});

it("marks a booking once its hour starts, once, and only frees it again through undo", async () => {
  const [id] = (await (await book({ date: "2026-11-17", hour: 11 })).json()).ids;
  const mark = { action: "mark", personId: "c1", outcome: "done", bookingId: id, operationId: "booking-mark-operation-1" };
  expect(await result(await call(sessions, "coach1", mark))).toEqual([409, "booking-not-started"]);
  vi.setSystemTime(NOW + 90 * 60_000);
  const marked = await (await call(sessions, "coach1", mark)).json();
  expect(mocks.store!.data.get(`sessionMarks/${marked.id}`)).toMatchObject({ bookingId: id, date: "2026-11-17", outcome: "done" });
  expect(mocks.store!.data.get("coachingPackages/pkg-c1")).toMatchObject({ sessionsUsed: 3 });
  expect(await result(await call(sessions, "coach1", { ...mark, outcome: "no_show", operationId: "booking-mark-operation-2" }))).toEqual([409, "booking-marked"]);
  expect(await result(await call(bookings, "coach1", { action: "cancel", bookingId: id }))).toEqual([409, "booking-marked"]);
  const listed = await (await call(schedule, "coach1", undefined, "?from=2026-11-17&to=2026-11-17")).json();
  expect(listed.bookings[0].mark).toEqual({ id: marked.id, outcome: "done" });
  await call(sessions, "coach1", { action: "undo", markId: marked.id });
  expect((await call(bookings, "coach1", { action: "cancel", bookingId: id })).status).toBe(200);
  expect((await (await call(schedule, "coach1", undefined, "?from=2026-11-17&to=2026-11-17")).json()).bookings).toEqual([]);
  expect(await result(await call(bookings, "coach2", { action: "cancel", bookingId: id }))).toEqual([404, "booking-unavailable"]);
});

it("lets the admin see every coach's bookings and book an unassigned client with a chosen coach, audited", async () => {
  mocks.store!.data.set("_serverConfig/admin", { uid: "admin1" });
  seedClient("c3", "coach1"); mocks.store!.data.delete("coachAssignments/c3");
  await book({});
  const admin = (body: unknown) => call(adminBookings, "admin1", body);
  expect(await result(await admin({ action: "book", personId: "c2", coachId: "coach1", date: "2026-11-19", hour: 9 }))).toEqual([409, "client-has-other-coach"]);
  expect(await result(await admin({ action: "book", personId: "c3", coachId: "coach1", date: "2026-11-19", hour: 16 }))).toEqual([409, "time-taken"]);
  const booked = await (await admin({ action: "book", personId: "c3", coachId: "coach2", date: "2026-11-19", hour: 16 })).json();
  expect(mocks.store!.data.get("coachAssignments/c3")).toMatchObject({ coachId: "coach2", assignedBy: "admin1" });
  const audit = [...mocks.store!.data].filter(([path]) => path.startsWith("auditEvents/")).map(([, row]) => row.action);
  expect(audit).toEqual(expect.arrayContaining(["coach-assigned", "coach-booking-created"]));
  const body = await (await call(adminSchedule, "admin1", undefined, "?from=2026-11-15&to=2026-11-21")).json();
  expect(body.bookings.map((row: { coachId: string; personId: string }) => [row.coachId, row.personId])).toEqual(expect.arrayContaining([["coach1", "c1"], ["coach2", "c3"]]));
  expect(body.coaches.map((coach: { id: string }) => coach.id)).toEqual(["coach1", "coach2"]);
  expect((await admin({ action: "cancel", bookingId: booked.ids[0] })).status).toBe(200);
  expect([...mocks.store!.data].some(([path, row]) => path.startsWith("auditEvents/") && row.action === "coach-booking-cancelled")).toBe(true);
  expect((await call(adminSchedule, "coach1", undefined, "?from=2026-11-15&to=2026-11-21")).status).toBe(403);
});
