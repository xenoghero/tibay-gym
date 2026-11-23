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
import { POST as assignments } from "@/app/api/admin/coach-assignments/route";
import { decideFreeze } from "./coaching";
import { memberSessions } from "./coach-bookings";
import { sessionHistory } from "./session-marks";

// Tuesday, Nov 17 2026, 10:00 AM in Manila.
const NOW = Date.parse("2026-11-17T02:00:00Z");
const H = (hour: number, minute = 0) => hour * 60 + minute;
const token = (uid: string) => { const value = `token-${uid}-0123456789abcdef`; mocks.tokens.set(value, uid); return value; };
const call = (handler: (request: Request) => Promise<Response>, uid: string, body?: unknown, query = "") => handler(new Request(`https://tibay.test/api${query}`, {
  method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token(uid)}` },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const result = async (response: Response) => [response.status, (await response.json()).error];
const book = (extra: Record<string, unknown>, coach = "coach1") => call(bookings, coach, { action: "book", personId: "c1", date: "2026-11-19", start: H(16), minutes: 60, ...extra });
const update = (extra: Record<string, unknown>, uid = "coach1") => call(uid === "admin1" ? adminBookings : bookings, uid, { action: "update", ...extra });
const rows = (prefix: string) => [...mocks.store!.data].filter(([path]) => path.startsWith(prefix)).map(([, row]) => row);
const seedClient = (id: string, coachId: string | null, sessionsUsed = 2) => {
  mocks.store!.data.set(`persons/${id}`, { name: `Client ${id}`, phone: "09123456789", type: "member", status: "active",
    coachingProfile: { fbName: id, goals: null, startDate: "2026-11-01", preferredSchedule: { weekdays: ["thu"], timeSlot: "afternoon" }, remarks: null } });
  mocks.store!.data.set(`coachingPackages/pkg-${id}`, { id: `pkg-${id}`, personId: id, chargeId: id, paymentRequestId: "r", packageId: "pkg-8", priceMinor: 1, sessions: 8,
    validityDays: 30, status: "active", submittedAt: NOW - 1000, approvedAt: NOW - 900, startedAt: NOW - 800, coachingExpiresAt: Date.parse("2026-12-18T00:00:00+08:00"), sessionsUsed, topUpSessions: 0 });
  if (coachId) mocks.store!.data.set(`coachAssignments/${id}`, { personId: id, coachId, assignedAt: NOW, assignedBy: "admin1" });
};
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin1");
  mocks.store = memoryFirestore(); mocks.tokens.clear();
  mocks.store.data.set("_serverConfig/admin", { uid: "admin1" });
  for (const id of ["coach1", "coach2"]) mocks.store.data.set(`coaches/${id}`, { name: id, email: `${id}@example.com`, active: true, createdAt: NOW, deactivatedAt: null });
  seedClient("c1", "coach1"); seedClient("c2", "coach2");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("adds a session with a start, length and muscles, weekly when asked, and refuses bad times and more sessions than are left", async () => {
  expect((await book({ start: H(16, 15), minutes: 45, muscles: ["Legs", "Back"] })).status).toBe(200);
  expect(rows("coachBookings/")[0]).toMatchObject({ date: "2026-11-19", start: H(16, 15), minutes: 45, muscles: ["Back", "Legs"], exercises: [], note: null });
  expect(await result(await book({ start: H(16, 10) }))).toEqual([400, "invalid-start"]);
  expect(await result(await book({ start: H(5, 45) }))).toEqual([400, "invalid-start"]);
  expect(await result(await book({ minutes: 50 }))).toEqual([400, "invalid-duration"]);
  expect(await result(await book({ start: H(21, 30), minutes: 60 }))).toEqual([400, "after-closing"]);
  expect(await result(await book({ muscles: ["Neck"] }))).toEqual([400, "invalid-muscles"]);
  expect(await result(await book({ personId: "c2" }))).toEqual([403, "client-not-assigned"]);
  expect(await result(await book({ date: "2026-11-20", weeks: 5 }))).toEqual([409, "after-coaching-expiry"]);
  // 6 sessions left, 1 already added: 5 more fit, 6 do not.
  mocks.store!.data.set("coachingPackages/pkg-c1", { ...mocks.store!.data.get("coachingPackages/pkg-c1"), coachingExpiresAt: Date.parse("2027-02-01T00:00:00+08:00") });
  expect(await result(await book({ date: "2026-11-20", weeks: 6 }))).toEqual([409, "not-enough-sessions"]);
  expect((await (await book({ date: "2026-11-20", weeks: 5 })).json()).ids).toHaveLength(5);
  expect(rows("coachBookings/").filter(row => row.seriesId).map(row => row.date)).toEqual(["2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18"]);
});

it("refuses overlapping sessions for the same coach and for the same client, across coaches", async () => {
  expect((await book({ start: H(16), minutes: 90 })).status).toBe(200);
  seedClient("c3", "coach1");
  expect(await result(await book({ personId: "c3", start: H(17), minutes: 60 }))).toEqual([409, "time-taken"]);
  expect((await book({ personId: "c3", start: H(17, 30), minutes: 30 })).status).toBe(200);
  // The admin can't put c1 with another coach at an overlapping time either.
  mocks.store!.data.delete("coachAssignments/c1");
  expect(await result(await call(adminBookings, "admin1", { action: "book", personId: "c1", coachId: "coach2", date: "2026-11-19", start: H(15, 30), minutes: 60 })))
    .toEqual([409, "client-time-taken"]);
});

it("adds walk-ins on past days up to 30 days back, and marks them right away", async () => {
  expect(await result(await book({ date: "2026-10-17" }))).toEqual([400, "invalid-session-date"]);
  const [id] = (await (await book({ date: "2026-11-10", start: H(7) })).json()).ids;
  const marked = await call(sessions, "coach1", { action: "mark", personId: "c1", outcome: "done", bookingId: id, operationId: "walk-in-mark-operation-1" });
  expect(marked.status).toBe(200);
  expect(rows("sessionMarks/")[0]).toMatchObject({ bookingId: id, date: "2026-11-10", outcome: "done" });
});

it("lists the coach's own sessions with their plan and mark, and each client's next session", async () => {
  seedClient("c3", "coach1");
  await book({ start: H(16, 30), muscles: ["Chest"] });
  await call(bookings, "coach2", { action: "book", personId: "c2", date: "2026-11-19", start: H(16), minutes: 60 });
  const body = await (await call(schedule, "coach1", undefined, "?from=2026-11-15&to=2026-11-21")).json();
  expect(body).toMatchObject({ today: "2026-11-17", minuteNow: H(10) });
  expect(body.bookings).toEqual([expect.objectContaining({ personId: "c1", date: "2026-11-19", start: H(16, 30), minutes: 60, muscles: ["Chest"], exercises: [], mark: null })]);
  expect(body.clients.map((c: { id: string; booked: number }) => [c.id, c.booked])).toEqual([["c1", 1], ["c3", 0]]);
  expect(body.clients[0].next).toEqual({ date: "2026-11-19", start: H(16, 30), coachId: "coach1" });
  expect(await result(await call(schedule, "coach1", undefined, "?from=2026-11-01&to=2027-01-15"))).toEqual([400, "invalid-range"]);
});

it("reads sessions saved before start times existed as whole-hour, 60-minute sessions", async () => {
  mocks.store!.data.set("coachBookings/old", { id: "old", coachId: "coach1", personId: "c1", date: "2026-11-19", hour: 9, seriesId: null, createdAt: NOW, cancelledAt: null });
  const body = await (await call(schedule, "coach1", undefined, "?from=2026-11-19&to=2026-11-19")).json();
  expect(body.bookings[0]).toMatchObject({ id: "old", start: H(9), minutes: 60, muscles: [], exercises: [], note: null });
  expect(await result(await book({ start: H(9, 30) }))).toEqual([409, "time-taken"]);
});

it("saves the plan any time, moves an unmarked session, and keeps a marked session's time for the coach", async () => {
  const [id] = (await (await book({ date: "2026-11-17", start: H(10, 30) })).json()).ids;
  const exercises = [{ name: " Lat pulldown ", done: true, sets: [{ reps: 10, kg: 40 }, { reps: 8, kg: 42.5 }] }, { name: "Face pull", done: false, sets: [] }];
  expect((await update({ bookingId: id, muscles: ["Back", "Arms"], exercises, note: "Watch the elbows" })).status).toBe(200);
  expect(mocks.store!.data.get(`coachBookings/${id}`)).toMatchObject({ muscles: ["Back", "Arms"], note: "Watch the elbows",
    exercises: [{ name: "Lat pulldown", done: true, sets: [{ reps: 10, kg: 40 }, { reps: 8, kg: 42.5 }] }, { name: "Face pull", done: false, sets: [] }] });
  expect(await result(await update({ bookingId: id, exercises: [{ name: "Row", done: true, sets: [{ reps: -1, kg: null }] }] }))).toEqual([400, "invalid-set"]);
  expect(await result(await update({ bookingId: id, exercises: Array.from({ length: 101 }, () => ({ name: "x", done: false, sets: [] })) }))).toEqual([400, "invalid-exercises"]);
  expect(await result(await update({ bookingId: id, exercises: [{ name: "Row", done: false, sets: Array.from({ length: 21 }, () => ({ reps: 1, kg: null })) }] }))).toEqual([400, "invalid-exercises"]);
  expect(await result(await update({ bookingId: id }, "coach2"))).toEqual([404, "booking-unavailable"]);
  expect((await update({ bookingId: id, start: H(10, 45), minutes: 90 })).status).toBe(200);
  vi.setSystemTime(NOW + 60 * 60_000);
  const mark = await (await call(sessions, "coach1", { action: "mark", personId: "c1", outcome: "done", bookingId: id, operationId: "plan-mark-operation-01" })).json();
  expect(mark.outcome).toBe("done");
  // Ticks and sets stay editable after marking; the time does not, for the coach.
  expect((await update({ bookingId: id, exercises: [{ name: "Face pull", done: true, sets: [{ reps: 15, kg: null }] }] })).status).toBe(200);
  expect(await result(await update({ bookingId: id, start: H(11) }))).toEqual([409, "booking-marked"]);
});

it("lets the admin mark any session for its coach, then move it with its mark, audited", async () => {
  const [id] = (await (await book({ date: "2026-11-16", start: H(8) })).json()).ids;
  const admin = (body: unknown) => call(adminBookings, "admin1", body);
  expect(await result(await admin({ action: "mark", personId: "c1", outcome: "done", operationId: "admin-mark-operation-01" }))).toEqual([400, "booking-required"]);
  expect((await admin({ action: "mark", personId: "c1", outcome: "done", bookingId: id, operationId: "admin-mark-operation-01" })).status).toBe(200);
  expect(rows("sessionMarks/")[0]).toMatchObject({ coachId: "coach1", bookingId: id, outcome: "done" });
  expect((await update({ bookingId: id, date: "2026-11-15", start: H(9) }, "admin1")).status).toBe(200);
  expect(mocks.store!.data.get(`coachBookings/${id}`)).toMatchObject({ date: "2026-11-15", start: H(9) });
  expect(rows("sessionMarks/")[0]).toMatchObject({ date: "2026-11-15" });
  expect(rows("auditEvents/").map(row => row.action)).toEqual(expect.arrayContaining(["session-marked", "coach-session-edited"]));
  expect((await call(adminSchedule, "coach1", undefined, "?from=2026-11-15&to=2026-11-21")).status).toBe(403);
});

it("lets the admin book an unassigned client with a chosen coach, audited", async () => {
  seedClient("c3", null);
  await book({});
  const admin = (body: unknown) => call(adminBookings, "admin1", body);
  expect(await result(await admin({ action: "book", personId: "c2", coachId: "coach1", date: "2026-11-19", start: H(9), minutes: 60 }))).toEqual([409, "client-has-other-coach"]);
  const booked = await (await admin({ action: "book", personId: "c3", coachId: "coach2", date: "2026-11-19", start: H(16), minutes: 60 })).json();
  expect(mocks.store!.data.get("coachAssignments/c3")).toMatchObject({ coachId: "coach2", assignedBy: "admin1" });
  expect(rows("auditEvents/").map(row => row.action)).toEqual(expect.arrayContaining(["coach-assigned", "coach-booking-created"]));
  const body = await (await call(adminSchedule, "admin1", undefined, "?from=2026-11-15&to=2026-11-21")).json();
  expect(body.coaches.map((coach: { id: string }) => coach.id)).toEqual(["coach1", "coach2"]);
  expect((await admin({ action: "cancel", bookingId: booked.ids[0] })).status).toBe(200);
});

it("moves upcoming sessions to the new coach on a switch, cancelling ones that clash", async () => {
  mocks.store!.data.set("coachingPackages/pkg-c1", { ...mocks.store!.data.get("coachingPackages/pkg-c1"), sessionsUsed: 0 });
  await book({ date: "2026-11-19", start: H(16) });
  await book({ date: "2026-11-20", start: H(8) });
  await call(bookings, "coach2", { action: "book", personId: "c2", date: "2026-11-20", start: H(8, 30), minutes: 60 });
  const switched = await (await call(assignments, "admin1", { personId: "c1", coachId: "coach2" })).json();
  expect(switched).toEqual({ ok: true, moved: 1, cancelled: [{ date: "2026-11-20", start: H(8) }] });
  const mine = rows("coachBookings/").filter(row => row.personId === "c1");
  expect(mine.find(row => row.date === "2026-11-19")).toMatchObject({ coachId: "coach2", cancelledAt: null });
  expect(mine.find(row => row.date === "2026-11-20")!.cancelledAt).toBe(NOW);
});

it("cancels unmarked sessions inside an approved Freeze and reports them", async () => {
  await book({ date: "2026-11-19" });
  await book({ date: "2026-12-10" });
  mocks.store!.data.set("coachingPackages/pkg-c1", { ...mocks.store!.data.get("coachingPackages/pkg-c1"), freeze: { status: "requested", requestedAt: NOW, startedAt: null, endedAt: null, days: null } });
  expect(await decideFreeze("admin1", { packageRecordId: "pkg-c1", decision: "approve" })).toEqual({ ok: true, cancelled: [{ date: "2026-11-19", start: H(16) }] });
  expect(rows("coachBookings/").filter(row => !row.cancelledAt).map(row => row.date)).toEqual(["2026-12-10"]);
});

it("gives the member their month of sessions with the plan, walk-ins without a time, and the next session", async () => {
  const [past] = (await (await book({ date: "2026-11-16", start: H(7), muscles: ["Legs"] })).json()).ids;
  await book({ date: "2026-11-19", start: H(16) });
  await update({ bookingId: past, exercises: [{ name: "Squat", done: true, sets: [{ reps: 8, kg: 60 }] }], note: "Good depth" });
  await call(sessions, "coach1", { action: "mark", personId: "c1", outcome: "done", bookingId: past, operationId: "member-history-mark-01" });
  await call(sessions, "coach1", { action: "mark", personId: "c1", outcome: "no_show", date: "2026-11-05", operationId: "member-history-mark-02" });
  const month = await memberSessions("c1", "2026-11");
  expect(month.sessions.map(row => [row.date, row.start, row.outcome])).toEqual([["2026-11-05", null, "no_show"], ["2026-11-16", H(7), "done"], ["2026-11-19", H(16), null]]);
  expect(month.sessions[1]).toMatchObject({ coachName: "coach1", muscles: ["Legs"], note: "Good depth", exercises: [{ name: "Squat", done: true, sets: [{ reps: 8, kg: 60 }] }] });
  expect(month.next).toMatchObject({ date: "2026-11-19", start: H(16), end: H(17), coachName: "coach1" });
  expect((await memberSessions("c1", "2026-12")).sessions).toEqual([]);
  await expect(memberSessions("c1", "2026-13")).rejects.toMatchObject({ code: "invalid-month" });
  expect((await sessionHistory("c1"))[0]).toMatchObject({ date: "2026-11-16", start: H(7), muscles: ["Legs"], exercisesDone: 1, exercisesTotal: 1, note: "Good depth" });
});
