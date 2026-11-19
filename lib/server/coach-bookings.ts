import "server-only";
import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { addManilaDays } from "@/lib/coaching/clocks";
import { FIRST_HOUR, LAST_HOUR, MAX_REPEAT_WEEKS, hasStarted, manilaHour, type Booking } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import type { CoachAssignment } from "@/lib/coaching/catalog";
import { prepareAssignment, assignedClientId, coachAssignments, coachClients, loadClient } from "./coach-clients";
import type { SessionMark } from "./session-marks";
import { appendAudit } from "./audit";

/** A coach acts on their own bookings; the admin on anyone's, audited. */
export type BookingActor = { coachId: string; adminId?: undefined } | { adminId: string; coachId?: undefined };

/** Bookings reach at most this far ahead, so "upcoming" reads stay one bounded date range. */
const AHEAD_DAYS = MAX_REPEAT_WEEKS * 7 + 7;

const day = (value: unknown, code = "invalid-date") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || addManilaDays(value, 0) !== value) throw new ApiError(400, code);
  return value;
};
const span = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

// Date-range reads only (single-field index); coach and client filters run in memory.
async function bookingsBetween(from: string, to: string, tx?: Transaction) {
  const query = adminDb().collection("coachBookings").where("date", ">=", from).where("date", "<=", to);
  return ((tx ? await tx.get(query) : await query.get()).docs.map(row => row.data() as Booking)).filter(row => !row.cancelledAt);
}
async function marksBetween(from: string, to: string, tx?: Transaction) {
  const query = adminDb().collection("sessionMarks").where("date", ">=", from).where("date", "<=", to);
  return ((tx ? await tx.get(query) : await query.get()).docs.map(row => row.data() as SessionMark)).filter(row => !row.undoneAt);
}
/** Bookings still to happen or still to be marked: from today on, with no mark yet. */
const open = (bookings: Booking[], marked: Set<string>, today: string) => bookings.filter(row => row.date >= today && !marked.has(row.id));

/**
 * The calendar for [from, to] (at most 62 days) with each client's upcoming bookings and whether they need one this week.
 * A coach sees their own bookings and clients; the admin (coachId null) sees every coach, unassigned clients and the active coaches.
 */
export async function coachSchedule(coachId: string | null, fromValue: unknown, toValue: unknown) {
  const from = day(fromValue), to = day(toValue);
  if (to < from || span(from, to) > 62) throw new ApiError(400, "invalid-range");
  const now = Date.now(), today = philippineDate(now);
  const [inRange, marks, ahead, todayMarks, roster] = await Promise.all([
    bookingsBetween(from, to), marksBetween(from, to), bookingsBetween(today, addManilaDays(today, AHEAD_DAYS)), marksBetween(today, today),
    coachId ? coachClients(coachId) : coachAssignments()]);
  const clients = "clients" in roster ? roster.clients : [...roster.unassigned, ...roster.assigned].sort((a, b) => a.name.localeCompare(b.name));
  const mine = (rows: Booking[]) => coachId ? rows.filter(row => row.coachId === coachId) : rows;
  const myMarks = coachId ? marks.filter(row => row.coachId === coachId) : marks, byBooking = new Map(myMarks.filter(row => row.bookingId).map(row => [row.bookingId!, row]));
  const upcoming = open(ahead, new Set(todayMarks.map(row => row.bookingId ?? "")), today);
  const weekEnd = addManilaDays(today, 6), hourNow = manilaHour(now);
  // The next booking that has not started yet, soonest first.
  const later = upcoming.filter(row => !hasStarted(row.date, row.hour, today, hourNow)).sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  return {
    today, hourNow,
    bookings: mine(inRange).map(row => {
      const mark = byBooking.get(row.id);
      return { id: row.id, coachId: row.coachId, personId: row.personId, date: row.date, hour: row.hour, seriesId: row.seriesId, mark: mark ? { id: mark.id, outcome: mark.outcome } : null };
    }),
    marks: myMarks.map(row => ({ date: row.date, outcome: row.outcome, coachId: row.coachId })),
    clients: clients.map(client => {
      const next = later.find(row => row.personId === client.id);
      return { ...client, booked: upcoming.filter(row => row.personId === client.id).length, next: next ? { date: next.date, hour: next.hour, coachId: next.coachId } : null,
        needsBooking: bookable(client) && !upcoming.some(row => row.personId === client.id && row.date <= weekEnd) };
    }),
    ...("coaches" in roster ? { coaches: roster.coaches } : {}),
  };
}

const bookable = (client: { frozen: boolean; status: string; sessionsLeft: number }) => !client.frozen && (client.status === "approved" || client.status === "active") && client.sessionsLeft > 0;

/**
 * Book one client at one hour, optionally the same weekday and hour for up to 12 weeks. Every booking needs a session to spend.
 * The admin books with the client's coach, or assigns an unassigned client to the chosen coach first.
 */
export async function bookSession(actor: BookingActor, body: Record<string, unknown>) {
  const first = day(body.date, "invalid-booking-date"), hour = body.hour, weeks = body.weeks ?? 1;
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < FIRST_HOUR || hour > LAST_HOUR) throw new ApiError(400, "invalid-booking-hour");
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) throw new ApiError(400, "invalid-repeat");
  const now = Date.now(), today = philippineDate(now);
  if (hasStarted(first, hour, today, manilaHour(now))) throw new ApiError(400, "booking-in-past");
  const dates = Array.from({ length: weeks }, (_, week) => addManilaDays(first, week * 7)), last = dates.at(-1)!;
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
  // Coaching validity ends at Manila midnight; a booking must fall on or before its last day.
  if (client.coachingExpiresAt && last > philippineDate(client.coachingExpiresAt - 1)) throw new ApiError(409, "after-coaching-expiry");
  const db = adminDb();
  return db.runTransaction(async tx => {
    // Assigning an unassigned client happens in the same transaction, so a refused booking leaves them unassigned.
    const commitAssignment = assign && actor.adminId ? await prepareAssignment(tx, db, actor.adminId, personId, coachId) : null;
    const [ahead, todayMarks] = await Promise.all([bookingsBetween(today, addManilaDays(today, AHEAD_DAYS), tx), marksBetween(today, today, tx)]);
    if (ahead.some(row => row.coachId === coachId && row.hour === hour && dates.includes(row.date))) throw new ApiError(409, "time-taken");
    const upcoming = open(ahead, new Set(todayMarks.map(row => row.bookingId ?? "")), today).filter(row => row.personId === personId).length;
    if (upcoming + weeks > client.sessionsLeft) throw new ApiError(409, "not-enough-sessions");
    commitAssignment?.();
    const seriesId = weeks > 1 ? randomUUID() : null;
    const ids = dates.map(date => {
      const id = randomUUID();
      tx.set(db.doc(`coachBookings/${id}`), { id, coachId, personId, date, hour, seriesId, createdAt: now, cancelledAt: null } satisfies Booking);
      return id;
    });
    if (actor.adminId) appendAudit(tx, db, { actorId: actor.adminId, action: "coach-booking-created", entityType: "coachBooking", entityId: ids[0], personId,
      operationId: seriesId ?? ids[0], after: { coachId, markDate: first }, reason: weeks > 1 ? `Weekly, ${weeks} sessions` : null, occurredAt: now });
    return { ids };
  });
}

/** Cancel a booking that has no session mark: a coach their own, the admin anyone's (audited). */
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
