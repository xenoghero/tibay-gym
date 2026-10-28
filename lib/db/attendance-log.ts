import { attendanceApi, type QrResponse } from "@/lib/attendance-api";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type CollectionReference,
  type DocumentReference,
  type FirestoreDataConverter,
  type Unsubscribe,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// Data model: project-plan.md §5. Separate historical collection. Rows are not
// deleted when sessions close, but profile deletion removes that person's rows.
// Keeping logs off `Person` avoids
// blowing the per-doc size limit and stops `Person` listeners firing on
// every visit; the dashboard's live counts listen to this collection alone.

export const ATTENDANCE_LOG_COLLECTION = "attendanceLogs";

export type CheckInSource = "qr" | "rfid";

/**
 * How an open session ended. `null` while the session is still open.
 * - "auto"     — 4-hour no-activity auto-close job
 * - "implicit" — a new check-in scan for the same person closed the old session
 * - "manual"   — admin force-close from the Person Profile
 */
export type SessionClosedReason = "auto" | "implicit" | "manual";

/** Shape as read back from Firestore (`id` injected from the doc id). */
export interface AttendanceLog {
  id: string;
  personId: string;
  source: CheckInSource;
  checkInAt: Timestamp;
  checkOutAt: Timestamp | null;
  closedReason: SessionClosedReason | null;
}

/** Stored document body — everything except the synthetic `id`. */
export type AttendanceLogDoc = Omit<AttendanceLog, "id">;

export const attendanceLogConverter: FirestoreDataConverter<
  AttendanceLog,
  AttendanceLogDoc
> = {
  toFirestore(log: WithFieldValue<AttendanceLog>) {
    const { id, ...rest } = log as AttendanceLog;
    return rest;
  },
  fromFirestore(snapshot, options): AttendanceLog {
    const data = snapshot.data(options) as AttendanceLogDoc;
    return { id: snapshot.id, ...data };
  },
};

export const attendanceLogsCollection = (): CollectionReference<
  AttendanceLog,
  AttendanceLogDoc
> =>
  collection(db, ATTENDANCE_LOG_COLLECTION).withConverter(attendanceLogConverter);

export const attendanceLogDoc = (
  id: string,
): DocumentReference<AttendanceLog, AttendanceLogDoc> =>
  doc(db, ATTENDANCE_LOG_COLLECTION, id).withConverter(attendanceLogConverter);

// --- Session lifecycle (project-plan.md §4b) ---------------------------------

/**
 * A session with no further activity for this long auto-closes. Also the window
 * the dashboard's "currently inside" count trusts an open row for.
 */
export const AUTO_CLOSE_AFTER_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Safety cap on a single stale-session sweep. The concurrently-open count at one
 * gym sits far below this; if a sweep ever hit the cap the remainder just closes
 * on the next check-in.
 */

/** Firestore `Timestamp` at local (gym-time) midnight today — the "today" cutoff
 *  the Overview tiles and activity feed scope their check-in queries to. */
export function startOfTodayTimestamp(): Timestamp {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

// --- Live listeners (Overview tab, TASKLIST Phase 7) ----------------------
// The dashboard's real-time counts and feed ride these; each returns the
// Firestore `Unsubscribe` so the caller can detach on unmount.

/**
 * Every check-in logged since local midnight, newest first. Drives the Overview
 * "check-ins today" / "today's split" tiles and the live activity feed.
 * Rejected RFID taps use a separate admin-only event listener. Range + order are on the same
 * field (`checkInAt`), so no composite index is needed. A row written with an
 * unresolved `serverTimestamp()` lands a beat later, once the server stamps it.
 */
export function watchTodaysLogs(
  onNext: (logs: AttendanceLog[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      attendanceLogsCollection(),
      where("checkInAt", ">=", startOfTodayTimestamp()),
      orderBy("checkInAt", "desc"),
    ),
    (snap) => onNext(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  );
}

/**
 * Every currently-open session (`checkOutAt == null`), regardless of when it
 * opened. Drives the Overview "currently inside" count. Callers should also
 * kick `closeStaleSessions()` on mount so a session past the 4-hour window that
 * no traffic has swept yet isn't counted as still inside.
 */
export function watchOpenSessions(
  onNext: (logs: AttendanceLog[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(attendanceLogsCollection(), where("checkOutAt", "==", null)),
    (snap) => onNext(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  );
}

/** Open (unclosed) sessions for one person. Expected to be 0 or 1 in practice. */
export async function getOpenSessionsForPerson(
  personId: string,
): Promise<AttendanceLog[]> {
  const snap = await getDocs(
    query(
      attendanceLogsCollection(),
      where("personId", "==", personId),
      where("checkOutAt", "==", null),
    ),
  );
  return snap.docs.map((d) => d.data());
}

/**
 * One person's visit history, newest check-in first (TASKLIST Phase 8 — Person
 * Profile). Equality on `personId` + order on `checkInAt` needs a composite
 * index; Firestore surfaces a one-click console link on first run if it isn't
 * there yet. Capped so a very frequent visitor's profile can't pull thousands
 * of rows in one read.
 */
export const VISIT_HISTORY_LIMIT = 100;

export async function getVisitHistoryForPerson(
  personId: string,
): Promise<AttendanceLog[]> {
  const snap = await getDocs(
    query(
      attendanceLogsCollection(),
      where("personId", "==", personId),
      orderBy("checkInAt", "desc"),
      limit(VISIT_HISTORY_LIMIT),
    ),
  );
  return snap.docs.map((d) => d.data());
}

/**
 * Safety cap on one Statistics-tab range query (TASKLIST Phase 10). A single
 * gym's "This month"/custom range sits far under this for the foreseeable
 * future — see the "Remaining Concern" note in statistics-tab-content.md about
 * this becoming a rollup collection if raw-log range scans ever get expensive.
 */
export const RANGE_QUERY_LIMIT = 5000;

/**
 * Every check-in with `checkInAt` inside `[start, end)`, oldest first
 * (TASKLIST Phase 10 — Statistics tab). One-shot, not a listener: the tab
 * queries on load and on range change rather than staying live
 * (statistics-tab-content.md §"Decisions locked"). Backs the summary tiles,
 * the check-ins-over-time/peak-hours/peak-days breakdowns, the top-visitors
 * list, and the CSV export — all derived client-side from the same rows so
 * the tab only makes one query per range change.
 */
export async function getLogsInRange(
  start: Timestamp,
  end: Timestamp,
): Promise<AttendanceLog[]> {
  const snap = await getDocs(
    query(
      attendanceLogsCollection(),
      where("checkInAt", ">=", start),
      where("checkInAt", "<", end),
      orderBy("checkInAt", "asc"),
      limit(RANGE_QUERY_LIMIT),
    ),
  );
  return snap.docs.map((d) => d.data());
}

/** Admin-authorized conditional close through the shared server guard. */
export async function forceCloseSession(logId: string): Promise<void> {
  await attendanceApi("/api/attendance/admin", { operation: "close", logId }, true);
}

// --- Reads -----------------------------------------------------------------

/** Request a throttled server sweep of conditional four-hour stale closes. */
export async function closeStaleSessions(options?: { caller: "public" | "admin" }): Promise<number> {
  const result = await attendanceApi<{ closed: number }>("/api/attendance/auto-close", options ?? { caller: "public" }, options?.caller === "admin");
  return result.closed;
}

// --- Writes --------------------------------------------------------------

/** What `recordCheckIn` actually did — the QR/RFID scan is a toggle, not an
 *  always-check-in action, so the caller needs to know which branch ran to
 *  render the right receipt. `checked-out` carries the session's original
 *  `checkInAt` so the caller can tell a real visit ("in for 3 hours") from an
 *  accidental double-scan ("checked in seconds ago") and frame the receipt
 *  accordingly. */
export type RecordCheckInResult =
  | { action: "checked-in" }
  | { action: "checked-out"; checkInAt: Timestamp };

/** Submit QR attendance through the shared server service. Reuse eventId/requestedAt on retries. */
export async function recordCheckIn(params: {
  personId: string;
  source: CheckInSource;
  eventId: string;
  requestedAt: number;
}): Promise<RecordCheckInResult> {
  if (params.source !== "qr") throw new Error("RFID requires the authenticated scanner service.");
  const result = await attendanceApi<QrResponse>("/api/attendance/scan", {
    personId: params.personId, eventId: params.eventId, requestedAt: params.requestedAt,
  });
  return result.action === "checked-out" ? { action: result.action, checkInAt: Timestamp.fromMillis(result.checkInAtMs) } : { action: result.action };
}

// --- Deletion & repair (TASKLIST Phase 8) --------------------------------
// Admin actions can delete rows through explicit correction and profile-cascade
// helpers; the public check-in path cannot — see `firestore.rules`. Because
// there are no Cloud Functions on the
// Spark plan, anything that removes a log is also responsible for fixing the
// denormalized `Person.visitCount` / `lastVisitAt`; a log deleted straight from
// the Firestore console bypasses that and is healed after the fact by
// `recalcVisitStats` while the person still exists.

/** Guarded admin maintenance for up to 400 visits. Larger profile cascades use backend profile deletion. */
export async function deleteAllLogsForPerson(personId: string): Promise<number> {
  const result = await attendanceApi<{ deleted: number }>("/api/attendance/admin", { operation: "delete-all-visits", personId }, true);
  return result.deleted;
}

/** Delete a visit and repair counters and guard references in one server transaction. */
export async function deleteVisit(params: {
  logId: string;
  personId: string;
}): Promise<{ visitCount: number; lastVisitAt: Timestamp | null }> {
  const result = await attendanceApi<{ visitCount: number; lastVisitAtMs: number | null }>("/api/attendance/admin", { operation: "delete-visit", ...params }, true);
  return { visitCount: result.visitCount, lastVisitAt: result.lastVisitAtMs === null ? null : Timestamp.fromMillis(result.lastVisitAtMs) };
}

/** Repair visit counters while coordinating with the shared attendance guard. */
export async function recalcVisitStats(
  personId: string,
): Promise<{ visitCount: number; lastVisitAt: Timestamp | null }> {
  const result = await attendanceApi<{ visitCount: number; lastVisitAtMs: number | null }>("/api/attendance/admin", { operation: "repair", personId }, true);
  return { visitCount: result.visitCount, lastVisitAt: result.lastVisitAtMs === null ? null : Timestamp.fromMillis(result.lastVisitAtMs) };
}
