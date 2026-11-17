import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { ClientPackage, CoachAssignment } from "@/lib/coaching/catalog";
import { addManilaDays, currentPackage } from "@/lib/coaching/clocks";
import { operationId, philippineDate } from "@/lib/finance/rules";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { appendAudit } from "./audit";
import { prepareStartPackage, startDuePackages } from "./coaching";
import type { Coach } from "./coaches";

/** One coach-accompanied workout (done) or a No-show, credited to the coach who recorded it. */
export interface SessionMark {
  id: string; personId: string; coachId: string; date: string; outcome: "done" | "no_show"; note: string | null;
  /** The package a done session was used from. */
  packageRecordId: string | null;
  createdAt: number; undoneAt: number | null; undoneBy: string | null;
}

const note = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) throw new ApiError(400, "invalid-note");
  return value.trim() || null;
};
/** A session date: a real Manila day, not in the future; coaches may go at most 30 days back, the admin any time. */
function markDate(value: unknown, now: number, maxDaysBack = 30) {
  const today = philippineDate(now);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || addManilaDays(value, 0) !== value || value > today || value < addManilaDays(today, -maxDaysBack)) throw new ApiError(400, "invalid-session-date");
  return value;
}
const outcome = (value: unknown) => { if (value !== "done" && value !== "no_show") throw new ApiError(400, "invalid-outcome"); return value; };

async function clientPackages(tx: Transaction, db: Firestore, personId: string) {
  return (await tx.get(db.collection("coachingPackages").where("personId", "==", personId))).docs.map(row => row.data() as ClientPackage);
}
/** Reads, then refuses a done mark the client can't use; returns the commit that consumes one session (starting the package if needed). */
async function prepareUse(tx: Transaction, db: Firestore, personId: string, now: number, actorId: string) {
  const person = (await tx.get(db.doc(`persons/${personId}`))).data();
  if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
  const current = currentPackage(await clientPackages(tx, db, personId), now);
  const start = current?.status === "approved" ? await prepareStartPackage(tx, db, personId, person, now, { actorId }) : null;
  if (!current || current.status === "used_up" || current.sessionsLeft <= 0 || (current.status === "approved" && !start)) throw new ApiError(409, "no-sessions-left");
  if (current.status === "expired" || (start && now >= start.coachingExpiresAt)) throw new ApiError(409, "coaching-expired");
  return { packageRecordId: current.record.id, commit() {
    start?.commit();
    tx.update(db.doc(`coachingPackages/${current.record.id}`), { sessionsUsed: current.record.sessionsUsed + 1 });
  } };
}

/** A coach marks a session done or records a No-show for one of their clients. */
export async function markSession(coachId: string, body: Record<string, unknown>) {
  const personId = documentId(body.personId), result = outcome(body.outcome), text = note(body.note);
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const db = adminDb(), id = `mark-${createHash("sha256").update(JSON.stringify([coachId, operation])).digest("hex").slice(0, 40)}`;
  // Save a due 15-day start first, so it stays saved even if this mark is refused.
  await startDuePackages(personId);
  return db.runTransaction(async tx => {
    const now = Date.now(), date = markDate(body.date ?? philippineDate(now), now), ref = db.doc(`sessionMarks/${id}`);
    const existing = (await tx.get(ref)).data() as SessionMark | undefined;
    if (existing) return { id, outcome: existing.outcome };
    const assignment = (await tx.get(db.doc(`coachAssignments/${personId}`))).data() as CoachAssignment | undefined;
    if (assignment?.coachId !== coachId) throw new ApiError(403, "client-not-assigned");
    const use = result === "done" ? await prepareUse(tx, db, personId, now, `coach:${coachId}`) : null;
    if (!use) { const person = (await tx.get(db.doc(`persons/${personId}`))).data(); if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable"); }
    use?.commit();
    tx.set(ref, { id, personId, coachId, date, outcome: result, note: text, packageRecordId: use?.packageRecordId ?? null, createdAt: now, undoneAt: null, undoneBy: null } satisfies SessionMark);
    return { id, outcome: result };
  });
}

/** Undo: the coach who made a mark on the same Manila day, or the admin at any time. Gives a used session back. */
export async function undoMark(actor: { coachId?: string; adminId?: string }, body: Record<string, unknown>) {
  const id = documentId(body.markId), db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`sessionMarks/${id}`), mark = (await tx.get(ref)).data() as SessionMark | undefined, now = Date.now();
    if (!mark) throw new ApiError(404, "mark-unavailable");
    if (mark.undoneAt) return { ok: true };
    if (!actor.adminId && (mark.coachId !== actor.coachId || philippineDate(mark.createdAt) !== philippineDate(now))) throw new ApiError(403, "mark-undo-closed");
    const packageRef = mark.packageRecordId ? db.doc(`coachingPackages/${mark.packageRecordId}`) : null;
    const record = packageRef ? (await tx.get(packageRef)).data() as ClientPackage | undefined : undefined;
    if (packageRef && record) tx.update(packageRef, { sessionsUsed: record.sessionsUsed - 1 });
    const by = actor.adminId ?? `coach:${actor.coachId}`;
    tx.update(ref, { undoneAt: now, undoneBy: by });
    if (actor.adminId) appendAudit(tx, db, { actorId: actor.adminId, action: "session-mark-undone", entityType: "sessionMark", entityId: id, personId: mark.personId,
      operationId: `undo-${id}`, before: { outcome: mark.outcome, markDate: mark.date }, after: { deleted: true }, occurredAt: now });
    return { ok: true };
  });
}

/** Admin fix of any mark's date, note or outcome; switching done/No-show uses or returns a session. */
export async function fixMark(adminId: string, body: Record<string, unknown>) {
  const id = documentId(body.markId), db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`sessionMarks/${id}`), mark = (await tx.get(ref)).data() as SessionMark | undefined, now = Date.now();
    if (!mark || mark.undoneAt) throw new ApiError(404, "mark-unavailable");
    const next = { date: body.date === undefined ? mark.date : markDate(body.date, now, 3650), note: body.note === undefined ? mark.note : note(body.note),
      outcome: body.outcome === undefined ? mark.outcome : outcome(body.outcome) };
    let packageRecordId = mark.packageRecordId, commit = () => {};
    if (mark.outcome === "done" && next.outcome === "no_show" && packageRecordId) {
      const packageRef = db.doc(`coachingPackages/${packageRecordId}`), record = (await tx.get(packageRef)).data() as ClientPackage | undefined;
      commit = () => { if (record) tx.update(packageRef, { sessionsUsed: record.sessionsUsed - 1 }); };
      packageRecordId = null;
    } else if (mark.outcome === "no_show" && next.outcome === "done") {
      const use = await prepareUse(tx, db, mark.personId, now, adminId);
      commit = use.commit; packageRecordId = use.packageRecordId;
    }
    commit();
    tx.update(ref, { ...next, packageRecordId });
    appendAudit(tx, db, { actorId: adminId, action: "session-mark-fixed", entityType: "sessionMark", entityId: id, personId: mark.personId, operationId: randomUUID(),
      before: { outcome: mark.outcome, markDate: mark.date }, after: { outcome: next.outcome, markDate: next.date,
        changedFields: (["date", "note", "outcome"] as const).filter(key => next[key] !== mark[key]) }, occurredAt: now });
    return { ok: true };
  });
}

/** Session adjustment: the admin sets a package's remaining sessions directly, with a required reason. */
export async function adjustSessions(adminId: string, body: Record<string, unknown>) {
  const id = documentId(body.packageRecordId), reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 500) throw new ApiError(400, "adjustment-reason-required");
  const left = body.sessionsLeft;
  if (typeof left !== "number" || !Number.isSafeInteger(left) || left < 0 || left > 500) throw new ApiError(400, "invalid-sessions-left");
  const db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`coachingPackages/${id}`), record = (await tx.get(ref)).data() as ClientPackage | undefined;
    if (!record || !["approved", "active"].includes(record.status)) throw new ApiError(409, "package-unavailable");
    const before = record.sessions + record.topUpSessions - record.sessionsUsed, now = Date.now();
    // sessionsUsed may go below zero when the admin grants more than were bought.
    tx.update(ref, { sessionsUsed: record.sessions + record.topUpSessions - left });
    appendAudit(tx, db, { actorId: adminId, action: "session-adjustment", entityType: "coachingPackage", entityId: id, personId: record.personId, operationId: randomUUID(),
      before: { sessionsLeft: before }, after: { sessionsLeft: left }, reason, occurredAt: now });
    return { ok: true, sessionsLeft: left };
  });
}

/** A client's marks, newest first, with the name of the coach each is credited to. */
export async function sessionHistory(personId: string) {
  const db = adminDb(), [rows, coaches] = await Promise.all([db.collection("sessionMarks").where("personId", "==", documentId(personId)).get(), db.collection("coaches").get()]);
  const names = new Map(coaches.docs.map(row => [row.id, (row.data() as Coach).name]));
  return rows.docs.map(row => row.data() as SessionMark).filter(mark => !mark.undoneAt)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .map(mark => ({ id: mark.id, date: mark.date, outcome: mark.outcome, note: mark.note, coachId: mark.coachId, coachName: names.get(mark.coachId) ?? "Former coach", createdAt: mark.createdAt }));
}

/** Monthly Coaching sessions and No-shows per coach (YYYY-MM, Manila), credited to whoever made each mark. */
export async function monthlyCoachCounts(month: unknown) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "invalid-month");
  const db = adminDb(), [rows, coaches] = await Promise.all([
    db.collection("sessionMarks").where("date", ">=", `${month}-01`).where("date", "<=", `${month}-31`).get(), db.collection("coaches").get()]);
  const counts = new Map<string, { done: number; noShows: number }>();
  for (const mark of rows.docs.map(row => row.data() as SessionMark)) {
    if (mark.undoneAt) continue;
    const count = counts.get(mark.coachId) ?? { done: 0, noShows: 0 };
    if (mark.outcome === "done") count.done++; else count.noShows++;
    counts.set(mark.coachId, count);
  }
  const names = new Map(coaches.docs.map(row => [row.id, (row.data() as Coach).name]));
  return { month, coaches: [...counts].map(([coachId, count]) => ({ coachId, name: names.get(coachId) ?? "Former coach", ...count })).sort((a, b) => a.name.localeCompare(b.name)) };
}
