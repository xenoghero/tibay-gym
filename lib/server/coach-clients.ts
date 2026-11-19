import "server-only";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { currentPackage, effectiveExpiry, packageState } from "@/lib/coaching/clocks";
import type { ClientPackage, CoachAssignment, CoachingProfile } from "@/lib/coaching/catalog";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { appendAudit } from "./audit";
import { settleDuePackages } from "./coaching";
import type { Coach } from "./coaches";
import { sessionHistory } from "./session-marks";

const available = (current: ReturnType<typeof currentPackage>) => !!current && (current.status === "approved" || current.status === "active");

/** Approved clients with coaching sessions available, keyed by person. Reading saves due 15-day starts first (ADR 0001: no scheduled job). */
async function clientsWithSessions() {
  const db = adminDb(), now = Date.now();
  const read = async () => (await Promise.all(["approved", "active"].map(status => db.collection("coachingPackages").where("status", "==", status).get())))
    .flatMap(rows => rows.docs.map(row => row.data() as ClientPackage));
  let records = await read();
  const due = [...new Set(records.filter(row => row.status === "approved").map(row => row.personId))];
  if ((await Promise.all(due.map(id => settleDuePackages(id, now)))).some(Boolean)) records = await read();
  const byPerson = new Map<string, ClientPackage[]>();
  for (const row of records) byPerson.set(row.personId, [...byPerson.get(row.personId) ?? [], row]);
  return new Map([...byPerson].map(([id, rows]) => [id, currentPackage(rows, now)] as const).filter(([, current]) => available(current)));
}

/** Only fields a coach may see: never address or payments. */
function clientView(id: string, person: Record<string, unknown>, current: { status: string; sessionsLeft: number; coachingExpiresAt: number | null; frozen?: boolean }) {
  const profile = (person.coachingProfile ?? null) as CoachingProfile | null;
  return { id, name: String(person.name ?? ""), phone: String(person.phone ?? ""), fbName: profile?.fbName ?? null, goals: profile?.goals ?? null,
    preferredSchedule: profile?.preferredSchedule ?? null, remarks: profile?.remarks ?? null,
    hasPhoto: Boolean(person.profileImagePath), photoPosition: (person.profileImagePosition ?? null) as { x: number; y: number } | null,
    status: current.status, sessionsLeft: current.sessionsLeft, coachingExpiresAt: current.coachingExpiresAt, frozen: !!current.frozen };
}

export async function coachAssignments() {
  const db = adminDb(), clients = await clientsWithSessions();
  const [assignments, coaches] = await Promise.all([db.collection("coachAssignments").get(), db.collection("coaches").get()]);
  const coachOf = new Map(assignments.docs.map(row => [row.id, (row.data() as CoachAssignment).coachId]));
  const names = new Map(coaches.docs.map(row => [row.id, (row.data() as Coach).name]));
  const rows = await Promise.all([...clients].map(async ([id, current]) => {
    const person = (await db.doc(`persons/${id}`).get()).data();
    return person && !person.deletingAt ? { ...clientView(id, person, { ...current!, coachingExpiresAt: effectiveExpiry(current!.record, Date.now()) }), coachId: coachOf.get(id) ?? null, coachName: names.get(coachOf.get(id) ?? "") ?? null } : null;
  }));
  const listed = rows.filter(row => row !== null);
  return { unassigned: listed.filter(row => !row.coachId), assigned: listed.filter(row => row.coachId),
    coaches: coaches.docs.filter(row => (row.data() as Coach).active).map(row => ({ id: row.id, name: (row.data() as Coach).name })) };
}

export async function assignCoach(actorId: string, body: Record<string, unknown>) {
  const personId = documentId(body.personId), coachId = documentId(body.coachId), db = adminDb();
  return db.runTransaction(async tx => { (await prepareAssignment(tx, db, actorId, personId, coachId))(); return { ok: true }; });
}

/** Reads and checks a coach assignment inside a transaction; returns the audited write (a no-op when unchanged). */
export async function prepareAssignment(tx: Transaction, db: Firestore, actorId: string, personId: string, coachId: string) {
  const coach = (await tx.get(db.doc(`coaches/${coachId}`))).data() as Coach | undefined;
  if (!coach?.active) throw new ApiError(409, "coach-unavailable");
  const person = (await tx.get(db.doc(`persons/${personId}`))).data();
  if (!person || person.deletingAt) throw new ApiError(409, "person-unavailable");
  const packages = await tx.get(db.collection("coachingPackages").where("personId", "==", personId));
  if (!packages.docs.some(row => ["approved", "active"].includes((row.data() as ClientPackage).status))) throw new ApiError(409, "coaching-client-required");
  const ref = db.doc(`coachAssignments/${personId}`), previous = (await tx.get(ref)).data() as CoachAssignment | undefined;
  return () => {
    if (previous?.coachId === coachId) return;
    const now = Date.now();
    tx.set(ref, { personId, coachId, assignedAt: now, assignedBy: actorId } satisfies CoachAssignment);
    appendAudit(tx, db, { actorId, action: "coach-assigned", entityType: "coachAssignment", entityId: personId, personId,
      operationId: randomUUID(), before: { coachId: previous?.coachId ?? null }, after: { coachId }, occurredAt: now });
  };
}

/** The client's coach name for check-in and the members portal, or null. */
export async function coachNameFor(personId: string) {
  const db = adminDb(), assignment = (await db.doc(`coachAssignments/${personId}`).get()).data() as CoachAssignment | undefined;
  const coach = assignment ? (await db.doc(`coaches/${assignment.coachId}`).get()).data() as Coach | undefined : undefined;
  return coach?.active ? coach.name : null;
}

export async function loadClient(id: string, now: number) {
  await settleDuePackages(id, now);
  const db = adminDb(), [person, packages] = await Promise.all([db.doc(`persons/${id}`).get(), db.collection("coachingPackages").where("personId", "==", id).get()]);
  const data = person.data();
  if (!data || data.deletingAt) return null;
  const current = currentPackage(packages.docs.map(doc => doc.data() as ClientPackage), now);
  // A client whose package ran out stays listed so the coach can see why.
  return clientView(id, data, current ? { ...current, coachingExpiresAt: effectiveExpiry(current.record, now) } : { status: "expired", sessionsLeft: 0, coachingExpiresAt: null });
}

export async function coachClients(coachId: string) {
  const mine = await adminDb().collection("coachAssignments").where("coachId", "==", coachId).get(), now = Date.now();
  const rows = await Promise.all(mine.docs.map(row => loadClient(row.id, now)));
  return { clients: rows.filter(row => row !== null).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** The client's id when they are assigned to this coach; otherwise 403. */
export async function assignedClientId(coachId: string, personId: unknown) {
  const id = documentId(personId), assignment = (await adminDb().doc(`coachAssignments/${id}`).get()).data() as CoachAssignment | undefined;
  if (assignment?.coachId !== coachId) throw new ApiError(403, "client-not-assigned");
  return id;
}

/** A coach reads only their own clients. */
export async function coachClient(coachId: string, personId: string) {
  const id = await assignedClientId(coachId, personId);
  const client = await loadClient(id, Date.now());
  if (!client) throw new ApiError(404, "client-unavailable");
  return { client, history: await sessionHistory(id) };
}

/** The admin's view of a client's current package, for Session adjustments. */
export async function clientPackageSummary(personId: string) {
  const id = documentId(personId), rows = await adminDb().collection("coachingPackages").where("personId", "==", id).get();
  const current = currentPackage(rows.docs.map(row => row.data() as ClientPackage), Date.now());
  // Each unexpired package and top-up holding is adjusted on its own, including ones with no sessions left.
  const now = Date.now(), holdings = rows.docs.map(row => row.data() as ClientPackage).filter(row => row.status === "approved" || row.status === "active")
    .map(record => ({ record, ...packageState(record, now) })).filter(row => row.status !== "expired");
  return current && { sessionsLeft: current.sessionsLeft, holdings: holdings.map(row => ({ id: row.record.id, topUp: !!row.record.topUp,
    sessions: row.record.sessions + row.record.topUpSessions, sessionsLeft: row.sessionsLeft, coachingExpiresAt: row.record.coachingExpiresAt })) };
}
