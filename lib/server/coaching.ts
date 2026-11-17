import "server-only";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { autoStartDeadline, coachingExpiryMs, membershipMonth, packageStartAt, packageState } from "@/lib/coaching/clocks";
import { coverageExpiryMs, snapshotMembership } from "@/lib/finance/coverage";
import { DEFAULT_COACHING, blocksNewPackage, validateCatalog, type ClientPackage, type CoachingPackage, type CoachingSettings } from "@/lib/coaching/catalog";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { appendAudit } from "./audit";

export const coachingSettings = (data: unknown): CoachingSettings => (data as CoachingSettings | undefined) ?? { ...DEFAULT_COACHING, packages: [...DEFAULT_COACHING.packages] };

export async function getCoachingSettings() {
  return coachingSettings((await adminDb().doc("gymSettings/coaching").get()).data());
}

export async function saveCoachingSettings(actorId: string, body: Record<string, unknown>) {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new ApiError(400, "invalid-body");
  const db = adminDb(), ref = db.doc("gymSettings/coaching");
  return db.runTransaction(async tx => {
    const current = coachingSettings((await tx.get(ref)).data());
    if (current.revision !== body.revision) throw new ApiError(409, "settings-changed");
    let packages;
    try { packages = validateCatalog(body.packages, current.packages); } catch (error) { throw new ApiError(400, (error as Error).message); }
    const now = Date.now(), next: CoachingSettings = { packages, revision: current.revision + 1, updatedAt: now, updatedBy: actorId };
    const changed = packages.filter(item => JSON.stringify(item) !== JSON.stringify(current.packages.find(old => old.id === item.id)));
    const describe = (item?: CoachingPackage) => item ? `PHP ${item.priceMinor / 100}, ${item.sessions} sessions, ${item.validityDays} days, ${item.visible ? "visible" : "hidden"}` : "new";
    tx.set(ref, next);
    appendAudit(tx, db, { actorId, action: "coaching-catalog-update", entityType: "settings", entityId: "coaching", personId: null,
      operationId: `coaching-settings-${next.revision}`, before: { revision: current.revision }, after: { revision: next.revision, changedFields: changed.map(item => item.id) }, occurredAt: now,
      reason: changed.map(item => `${item.id}: ${describe(current.packages.find(old => old.id === item.id))} -> ${describe(item)}`).join("; ") || null });
    return next;
  });
}

/** Refuses a new package while another of the client's packages still counts (pending, not started, or active with sessions). */
export async function assertNoActivePackage(personId: string, exceptId?: string, tx?: Transaction, db: Firestore = adminDb()) {
  const query = db.collection("coachingPackages").where("personId", "==", personId);
  const rows = tx ? await tx.get(query) : await query.get();
  if (rows.docs.some(row => row.id !== exceptId && blocksNewPackage(row.data() as ClientPackage, Date.now()))) throw new ApiError(409, "coaching-package-active");
}

type Member = { type?: unknown; status?: unknown; membershipExpiry?: Timestamp | null; joinDate?: Timestamp | null; deletingAt?: unknown };
/**
 * Package start, shared by the first check-in, the first Coaching session and the 15-day automatic start.
 * Reads only; `commit` writes. Starts at `firstUseAt`, or at the 15-day deadline when that already passed,
 * and adds one membership month after any membership already paid for.
 */
export async function prepareStartPackage(tx: Transaction, db: Firestore, personId: string, person: Member, firstUseAt: number, via: { logId?: string; actorId: string }) {
  const rows = await tx.get(db.collection("coachingPackages").where("personId", "==", personId).where("status", "==", "approved"));
  const record = rows.docs[0]?.data() as ClientPackage | undefined;
  if (!record?.approvedAt) return null;
  const startedAt = packageStartAt(record.approvedAt, firstUseAt), coverage = membershipMonth(snapshotMembership(person), startedAt);
  const monthStartMs = Date.parse(`${coverage.startDate}T00:00:00+08:00`);
  const membershipExpiry = Timestamp.fromMillis(coverageExpiryMs(coverage)), coachingExpiresAt = coachingExpiryMs(startedAt, record.validityDays);
  return { record, startedAt, coachingExpiresAt,
    /** Whether the included membership month covers this moment. */
    covers: (at: number) => monthStartMs <= at && at < membershipExpiry.toMillis(),
    commit() {
      const stamp = Timestamp.fromMillis(Date.now());
      tx.update(db.doc(`coachingPackages/${record.id}`), { status: "active", startedAt, coachingExpiresAt, startedByLogId: via.logId ?? null });
      tx.update(db.doc(`persons/${personId}`), { type: "member", status: "active", membershipExpiry,
        joinDate: person.joinDate ?? Timestamp.fromMillis(monthStartMs), updatedAt: stamp });
      tx.set(db.doc(`statusChanges/coaching-start-${record.id}`), { personId, fromStatus: person.status ?? null, toStatus: "active", reason: "Coaching package started",
        changedAt: stamp, previousExpiry: person.membershipExpiry ?? null, newExpiry: membershipExpiry });
      appendAudit(tx, db, { actorId: via.actorId, action: "coaching-package-started", entityType: "coachingPackage", entityId: record.id, personId,
        operationId: `coaching-start-${record.id}`, before: { status: "approved" }, after: { status: "active", membershipExpiry: membershipExpiry.toMillis() } });
    } };
}

/** Saves the 15-day automatic start (dated at the deadline) for a package nobody started; called wherever a package is read. Returns whether one started. */
export async function startDuePackages(personId: string, now = Date.now()): Promise<boolean> {
  const db = adminDb(), due = await db.collection("coachingPackages").where("personId", "==", personId).where("status", "==", "approved").get();
  if (!due.docs.some(row => autoStartDeadline((row.data() as ClientPackage).approvedAt ?? Infinity) <= now)) return false;
  return db.runTransaction(async tx => {
    const person = (await tx.get(db.doc(`persons/${personId}`))).data() as Member | undefined;
    if (!person || person.deletingAt) return false;
    const start = await prepareStartPackage(tx, db, personId, person, now, { actorId: "system:coaching-auto-start" });
    // Re-checked in the transaction: a check-in may have started it first.
    if (!start || start.startedAt >= now) return false;
    start.commit(); return true;
  });
}

/** What the check-in screen shows: the client's current package, and whether this visit started it. */
export async function checkinCoaching(personId: string, logId?: string) {
  const rows = await adminDb().collection("coachingPackages").where("personId", "==", personId).get(), now = Date.now();
  const record = rows.docs.map(row => row.data() as ClientPackage).filter(row => row.status === "approved" || row.status === "active")
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];
  if (!record) return null;
  const { status, sessionsLeft } = packageState(record, now);
  return { status, sessionsLeft, coachingExpiresAt: record.coachingExpiresAt, started: !!logId && record.startedByLogId === logId };
}

/** What the members portal shows: visible packages and the client's latest package. */
export async function customerCoaching(personId: string) {
  await startDuePackages(personId);
  const db = adminDb(), settings = await getCoachingSettings(), now = Date.now();
  const rows = await db.collection("coachingPackages").where("personId", "==", personId).get();
  const records = rows.docs.map(row => row.data() as ClientPackage);
  const latest = records.filter(row => row.status !== "closed").sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
  return { packages: settings.packages.filter(item => item.visible), canBuy: !records.some(record => blocksNewPackage(record, now)),
    current: latest && { ...packageState(latest, now), sessions: latest.sessions,
      validityDays: latest.validityDays, priceMinor: latest.priceMinor, approvedAt: latest.approvedAt, startedAt: latest.startedAt, coachingExpiresAt: latest.coachingExpiresAt } };
}
