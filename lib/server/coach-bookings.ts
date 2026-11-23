import "server-only";
import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { addManilaDays } from "@/lib/coaching/clocks";
import { MAX_REPEAT_WEEKS, endOf, hasStarted, lengthOf, manilaMinute, overlaps, readPlan, startOf, timeError, type Booking } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import type { CoachAssignment } from "@/lib/coaching/catalog";
import { prepareAssignment, assignedClientId, coachAssignments, coachClients, loadClient } from "./coach-clients";
import type { SessionMark } from "./session-marks";
import type { Coach } from "./coaches";
import { appendAudit } from "./audit";

/** A coach acts on their own sessions; the admin on anyone's, audited. */
export type BookingActor = { coachId: string; adminId?: undefined } | { adminId: string; coachId?: undefined };

/** Sessions reach at most this far ahead, so "upcoming" reads stay one bounded date range. */
const AHEAD_DAYS = MAX_REPEAT_WEEKS * 7 + 7;
/** Coaches add, edit and mark sessions at most this many days back; older ones go to the admin. */
const COACH_DAYS_BACK = 30, ADMIN_DAYS_BACK = 3650;

const day = (value: unknown, code = "invalid-date") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || addManilaDays(value, 0) !== value) throw new ApiError(400, code);
  return value;
};
const span = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const time = (start: unknown, minutes: unknown) => {
  const code = timeError(start, minutes);
  if (code) throw new ApiError(400, code);
  return { start: start as number, minutes: minutes as number };
};
const plan = (body: Record<string, unknown>) => {
  try { return readPlan(body); } catch (err) { throw new ApiError(400, err instanceof Error ? err.message : "invalid-plan"); }
};
const asTime = (row: Booking) => ({ date: row.date, start: startOf(row), minutes: lengthOf(row) });

// Date-range reads only (single-field index); coach and client filters run in memory.
async function bookingsBetween(from: string, to: string, tx?: Transaction) {
  const query = adminDb().collection("coachBookings").where("date", ">=", from).where("date", "<=", to);
  return ((tx ? await tx.get(query) : await query.get()).docs.map(row => row.data() as Booking)).filter(row => !row.cancelledAt);
}
async function marksBetween(from: string, to: string, tx?: Transaction) {
  const query = adminDb().collection("sessionMarks").where("date", ">=", from).where("date", "<=", to);
  return ((tx ? await tx.get(query) : await query.get()).docs.map(row => row.data() as SessionMark)).filter(row => !row.undoneAt);
}
/** Sessions still to happen or still to be marked: from today on, with no mark yet. */
const open = (bookings: Booking[], marked: Set<string>, today: string) => bookings.filter(row => row.date >= today && !marked.has(row.id));
/** The coach's or the client's session that a new time would overlap, if any. */
function clash(rows: Booking[], at: { date: string; start: number; minutes: number }, coachId: string, personId: string, except?: string) {
  const hit = rows.find(row => row.id !== except && (row.coachId === coachId || row.personId === personId) && overlaps(asTime(row), at));
  if (hit) throw new ApiError(409, hit.coachId === coachId ? "time-taken" : "client-time-taken");
}

/** What the Schedule shows of one session. */
const view = (row: Booking, mark: SessionMark | undefined) => ({
  id: row.id, coachId: row.coachId, personId: row.personId, date: row.date, start: startOf(row), minutes: lengthOf(row), seriesId: row.seriesId,
  muscles: row.muscles ?? [], exercises: row.exercises ?? [], note: row.note ?? mark?.note ?? null,
  mark: mark ? { id: mark.id, outcome: mark.outcome, coachId: mark.coachId, createdAt: mark.createdAt } : null,
});

/**
 * The sessions in [from, to] (at most 62 days) with each client's upcoming count and next session.
 * A coach sees their own sessions and clients; the admin (coachId null) sees every coach, unassigned clients and the active coaches.
 */
export async function coachSchedule(coachId: string | null, fromValue: unknown, toValue: unknown) {
  const from = day(fromValue), to = day(toValue);
  if (to < from || span(from, to) > 62) throw new ApiError(400, "invalid-range");
  const now = Date.now(), today = philippineDate(now), minuteNow = manilaMinute(now);
  const [inRange, marks, ahead, todayMarks, roster] = await Promise.all([
    bookingsBetween(from, to), marksBetween(from, to), bookingsBetween(today, addManilaDays(today, AHEAD_DAYS)), marksBetween(today, today),
    coachId ? coachClients(coachId) : coachAssignments()]);
  const clients = "clients" in roster ? roster.clients : [...roster.unassigned, ...roster.assigned].sort((a, b) => a.name.localeCompare(b.name));
  const byBooking = new Map(marks.filter(row => row.bookingId).map(row => [row.bookingId!, row]));
  const mine = coachId ? inRange.filter(row => row.coachId === coachId) : inRange;
  const upcoming = open(ahead, new Set(todayMarks.map(row => row.bookingId ?? "")), today);
  // The next session that has not started yet, soonest first.
  const later = upcoming.filter(row => !hasStarted(row.date, startOf(row), today, minuteNow)).sort((a, b) => a.date.localeCompare(b.date) || startOf(a) - startOf(b));
  return {
    today, minuteNow,
    bookings: mine.map(row => view(row, byBooking.get(row.id))),
    clients: clients.map(client => {
      const next = later.find(row => row.personId === client.id);
      return { ...client, booked: upcoming.filter(row => row.personId === client.id).length, next: next ? { date: next.date, start: startOf(next), coachId: next.coachId } : null };
    }),
    ...("coaches" in roster ? { coaches: roster.coaches } : {}),
  };
}

const bookable = (client: { frozen: boolean; status: string; sessionsLeft: number }) => !client.frozen && (client.status === "approved" || client.status === "active") && client.sessionsLeft > 0;

/**
 * Add a session for one client: a start time and length, optionally the same weekday and time for up to 12 weeks, with optional target muscles.
 * Past days (walk-ins) are allowed up to 30 days back for coaches. Neither the coach nor the client may have an overlapping session.
 * The admin adds with the client's coach, or assigns an unassigned client to the chosen coach first.
 */
export async function bookSession(actor: BookingActor, body: Record<string, unknown>) {
  const first = day(body.date, "invalid-booking-date"), { start, minutes } = time(body.start, body.minutes), weeks = body.weeks ?? 1, { muscles } = plan({ muscles: body.muscles ?? [] });
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) throw new ApiError(400, "invalid-repeat");
  const now = Date.now(), today = philippineDate(now);
  if (first < addManilaDays(today, -(actor.adminId ? ADMIN_DAYS_BACK : COACH_DAYS_BACK))) throw new ApiError(400, "invalid-session-date");
  const dates = Array.from({ length: weeks }, (_, week) => addManilaDays(first, week * 7)), last = dates.at(-1)!;
  if (last > addManilaDays(today, AHEAD_DAYS)) throw new ApiError(400, "too-far-ahead");
  let coachId: string, personId: string, assign = false;
  if (actor.adminId !== undefined) {
    coachId = documentId(body.coachId); personId = documentId(body.personId);
    const assignment = (await adminDb().doc(`coachAssignments/${personId}`).get()).data() as CoachAssignment | undefined;
    if (assignment && assignment.coachId !== coachId) throw new ApiError(409, "client-has-other-coach");
    assign = !assignment;
  } else { coachId = actor.coachId; personId = await assignedClientId(coachId, body.personId); }
  const client = await loadClient(personId, now);
  if (!client) throw new ApiError(404, "client-unavailable");
  if (client.frozen) throw new ApiError(409, "client-frozen");
  if (client.status === "expired") throw new ApiError(409, "coaching-expired");
  if (!bookable(client)) throw new ApiError(409, "no-sessions-left");
  // Coaching validity ends at Manila midnight; a session must fall on or before its last day.
  if (client.coachingExpiresAt && last > philippineDate(client.coachingExpiresAt - 1)) throw new ApiError(409, "after-coaching-expiry");
  const db = adminDb();
  return db.runTransaction(async tx => {
    // Assigning an unassigned client happens in the same transaction, so a refused session leaves them unassigned.
    const commitAssignment = assign && actor.adminId ? await prepareAssignment(tx, db, actor.adminId, personId, coachId) : null;
    const from = first < today ? first : today;
    const [rows, todayMarks] = await Promise.all([bookingsBetween(from, addManilaDays(today, AHEAD_DAYS), tx), marksBetween(today, today, tx)]);
    for (const date of dates) clash(rows, { date, start, minutes }, coachId, personId);
    const upcoming = open(rows, new Set(todayMarks.map(row => row.bookingId ?? "")), today).filter(row => row.personId === personId).length;
    if (upcoming + weeks > client.sessionsLeft) throw new ApiError(409, "not-enough-sessions");
    commitAssignment?.();
    const seriesId = weeks > 1 ? randomUUID() : null;
    const ids = dates.map(date => {
      const id = randomUUID();
      tx.set(db.doc(`coachBookings/${id}`), { id, coachId, personId, date, start, minutes, muscles: muscles!, exercises: [], note: null, seriesId, createdAt: now, cancelledAt: null } satisfies Booking);
      return id;
    });
    if (actor.adminId) appendAudit(tx, db, { actorId: actor.adminId, action: "coach-booking-created", entityType: "coachBooking", entityId: ids[0], personId,
      operationId: seriesId ?? ids[0], after: { coachId, markDate: first }, reason: weeks > 1 ? `Weekly, ${weeks} sessions` : null, occurredAt: now });
    return { ids };
  });
}

/**
 * Edit a session: its plan (target muscles, Exercise checklist with sets, note) at any time, and its day, start and length while unmarked.
 * Coaches edit their own sessions from the last 30 days on; the admin edits any session, marked or not, audited.
 */
export async function updateSession(actor: BookingActor, body: Record<string, unknown>) {
  const id = documentId(body.bookingId), changes = plan(body), db = adminDb();
  const moving = body.date !== undefined || body.start !== undefined || body.minutes !== undefined;
  return db.runTransaction(async tx => {
    const ref = db.doc(`coachBookings/${id}`), booking = (await tx.get(ref)).data() as Booking | undefined, now = Date.now(), today = philippineDate(now);
    if (!booking || booking.cancelledAt || (!actor.adminId && booking.coachId !== actor.coachId)) throw new ApiError(404, "booking-unavailable");
    if (!actor.adminId && booking.date < addManilaDays(today, -COACH_DAYS_BACK)) throw new ApiError(403, "invalid-session-date");
    const marks = (await tx.get(db.collection("sessionMarks").where("bookingId", "==", id))).docs.map(row => row.data() as SessionMark).filter(row => !row.undoneAt);
    const next = { ...asTime(booking) };
    if (moving) {
      if (marks.length && !actor.adminId) throw new ApiError(409, "booking-marked");
      Object.assign(next, time(body.start ?? next.start, body.minutes ?? next.minutes));
      if (body.date !== undefined) next.date = day(body.date, "invalid-booking-date");
      if (!actor.adminId && next.date < addManilaDays(today, -COACH_DAYS_BACK)) throw new ApiError(400, "invalid-session-date");
      clash(await bookingsBetween(next.date, next.date, tx), next, booking.coachId, booking.personId, id);
    }
    const update = { ...changes, ...(moving ? { date: next.date, start: next.start, minutes: next.minutes } : {}) };
    tx.update(ref, update);
    // A marked session moved by the admin keeps its mark on the same day.
    if (moving && next.date !== booking.date) for (const mark of marks) tx.update(db.doc(`sessionMarks/${mark.id}`), { date: next.date });
    if (actor.adminId) appendAudit(tx, db, { actorId: actor.adminId, action: "coach-session-edited", entityType: "coachBooking", entityId: id, personId: booking.personId,
      operationId: randomUUID(), before: { coachId: booking.coachId, markDate: booking.date }, after: { markDate: next.date, changedFields: Object.keys(update) }, occurredAt: now });
    return { ok: true };
  });
}

/** Cancel a session that has no mark: a coach their own, the admin anyone's (audited). */
export async function cancelBooking(actor: BookingActor, body: Record<string, unknown>) {
  const id = documentId(body.bookingId), db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`coachBookings/${id}`), booking = (await tx.get(ref)).data() as Booking | undefined;
    if (!booking || (!actor.adminId && booking.coachId !== actor.coachId)) throw new ApiError(404, "booking-unavailable");
    if (booking.cancelledAt) return { ok: true };
    const marks = await tx.get(db.collection("sessionMarks").where("bookingId", "==", id));
    if (marks.docs.some(row => !(row.data() as SessionMark).undoneAt)) throw new ApiError(409, "booking-marked");
    const now = Date.now();
    tx.update(ref, { cancelledAt: now });
    if (actor.adminId) appendAudit(tx, db, { actorId: actor.adminId, action: "coach-booking-cancelled", entityType: "coachBooking", entityId: id, personId: booking.personId,
      operationId: `cancel-${id}`, before: { coachId: booking.coachId, markDate: booking.date }, after: { deleted: true }, occurredAt: now });
    return { ok: true };
  });
}

/**
 * The member's own Coaching sessions in one month (YYYY-MM, Manila), oldest first, plus their next session.
 * Marks recorded without a session (walk-ins before scheduling existed) appear as "no time" entries.
 */
export async function memberSessions(personIdValue: string, month: unknown) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "invalid-month");
  const personId = documentId(personIdValue), db = adminDb(), now = Date.now(), today = philippineDate(now), minuteNow = manilaMinute(now);
  const [bookingRows, markRows, coaches] = await Promise.all([db.collection("coachBookings").where("personId", "==", personId).get(),
    db.collection("sessionMarks").where("personId", "==", personId).get(), db.collection("coaches").get()]);
  const names = new Map(coaches.docs.map(row => [row.id, (row.data() as Coach).name]));
  const bookings = bookingRows.docs.map(row => row.data() as Booking).filter(row => !row.cancelledAt);
  const marks = markRows.docs.map(row => row.data() as SessionMark).filter(row => !row.undoneAt);
  const byBooking = new Map(marks.filter(row => row.bookingId).map(row => [row.bookingId!, row]));
  const sessions = [
    ...bookings.filter(row => row.date.startsWith(month)).map(row => {
      const mark = byBooking.get(row.id);
      return { id: row.id, date: row.date, start: startOf(row) as number | null, minutes: lengthOf(row) as number | null, coachName: names.get(row.coachId) ?? "Former coach",
        outcome: mark?.outcome ?? null, started: hasStarted(row.date, startOf(row), today, minuteNow), muscles: row.muscles ?? [], exercises: row.exercises ?? [], note: row.note ?? mark?.note ?? null };
    }),
    ...marks.filter(row => !row.bookingId && row.date.startsWith(month)).map(mark => ({ id: mark.id, date: mark.date, start: null, minutes: null,
      coachName: names.get(mark.coachId) ?? "Former coach", outcome: mark.outcome, started: true, muscles: [], exercises: [], note: mark.note })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? -1) - (b.start ?? -1));
  const next = bookings.filter(row => !byBooking.has(row.id) && !hasStarted(row.date, startOf(row), today, minuteNow))
    .sort((a, b) => a.date.localeCompare(b.date) || startOf(a) - startOf(b))[0];
  return { month, today, sessions, next: next ? { date: next.date, start: startOf(next), end: endOf(next), coachName: names.get(next.coachId) ?? "Former coach", muscles: next.muscles ?? [] } : null };
}
