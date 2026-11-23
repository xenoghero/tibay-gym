import "server-only";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { FREEZE_MAX_DAYS, addManilaDays, autoStartDeadline, coachingExpiryMs, currentPackage, effectiveExpiry, freezeAutoEnd, freezeDays, membershipMonth, packageStartAt, packageState } from "@/lib/coaching/clocks";
import { startOf, type Booking } from "@/lib/coaching/bookings";
import { philippineDate } from "@/lib/finance/rules";
import type { SessionMark } from "./session-marks";
import { coverageExpiryMs, snapshotMembership } from "@/lib/finance/coverage";
import { DEFAULT_COACHING, blocksNewPackage, validateCatalog, validateTopUps, type ClientPackage, type CoachingPackage, type CoachingSettings, type Freeze } from "@/lib/coaching/catalog";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { appendAudit } from "./audit";
import { coachNameFor } from "./coach-clients";

// Saved settings from before top-ups existed take the top-up defaults.
export const coachingSettings = (data: unknown): CoachingSettings => ({ ...DEFAULT_COACHING, packages: [...DEFAULT_COACHING.packages], ...(data as Partial<CoachingSettings> | undefined) });

export async function getCoachingSettings() {
  return coachingSettings((await adminDb().doc("gymSettings/coaching").get()).data());
}

export async function saveCoachingSettings(actorId: string, body: Record<string, unknown>) {
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new ApiError(400, "invalid-body");
  const db = adminDb(), ref = db.doc("gymSettings/coaching");
  return db.runTransaction(async tx => {
    const current = coachingSettings((await tx.get(ref)).data());
    if (current.revision !== body.revision) throw new ApiError(409, "settings-changed");
    let packages, topUps;
    try { packages = validateCatalog(body.packages, current.packages); topUps = validateTopUps({ topUpPriceMinor: body.topUpPriceMinor ?? current.topUpPriceMinor, topUpValidityDays: body.topUpValidityDays ?? current.topUpValidityDays }); }
    catch (error) { throw new ApiError(400, (error as Error).message); }
    const now = Date.now(), next: CoachingSettings = { packages, ...topUps, revision: current.revision + 1, updatedAt: now, updatedBy: actorId };
    const topUpChange = topUps.topUpPriceMinor !== current.topUpPriceMinor || topUps.topUpValidityDays !== current.topUpValidityDays
      ? `top-ups: PHP ${current.topUpPriceMinor / 100}/session, ${current.topUpValidityDays} days -> PHP ${topUps.topUpPriceMinor / 100}/session, ${topUps.topUpValidityDays} days` : null;
    const changed = packages.filter(item => JSON.stringify(item) !== JSON.stringify(current.packages.find(old => old.id === item.id)));
    const describe = (item?: CoachingPackage) => item ? `PHP ${item.priceMinor / 100}, ${item.sessions} sessions, ${item.validityDays} days, ${item.visible ? "visible" : "hidden"}` : "new";
    tx.set(ref, next);
    appendAudit(tx, db, { actorId, action: "coaching-catalog-update", entityType: "settings", entityId: "coaching", personId: null,
      operationId: `coaching-settings-${next.revision}`, before: { revision: current.revision }, after: { revision: next.revision, changedFields: changed.map(item => item.id) }, occurredAt: now,
      reason: [...changed.map(item => `${item.id}: ${describe(current.packages.find(old => old.id === item.id))} -> ${describe(item)}`), ...(topUpChange ? [topUpChange] : [])].join("; ") || null });
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

/**
 * Saves changes that happen by themselves, wherever a package is read (ADR 0001: no scheduled job): the 15-day
 * automatic start (dated at the deadline), the automatic end of a 14-day Freeze, and dropping a Freeze request
 * once the coaching expiry passes. Returns whether a package started (which changes the membership).
 */
export async function settleDuePackages(personId: string, now = Date.now()): Promise<boolean> {
  const db = adminDb(), rows = (await db.collection("coachingPackages").where("personId", "==", personId).get()).docs.map(row => row.data() as ClientPackage);
  if (rows.some(row => freezeDue(row, now))) await db.runTransaction(async tx => {
    const fresh = await tx.get(db.collection("coachingPackages").where("personId", "==", personId));
    for (const doc of fresh.docs) {
      const record = doc.data() as ClientPackage, freeze = record.freeze!;
      if (!freezeDue(record, now)) continue;
      if (freeze.status === "requested") { tx.update(doc.ref, { freeze: { ...freeze, status: "dropped", endedAt: now } }); continue; }
      const endedAt = freezeAutoEnd(freeze.startedAt!), days = freezeDays(freeze.startedAt!, endedAt);
      tx.update(doc.ref, { freeze: { ...freeze, status: "ended", endedAt, days }, coachingExpiresAt: record.coachingExpiresAt! + days * 86_400_000 });
    }
  });
  if (!rows.some(row => row.status === "approved" && autoStartDeadline(row.approvedAt ?? Infinity) <= now)) return false;
  return db.runTransaction(async tx => {
    const person = (await tx.get(db.doc(`persons/${personId}`))).data() as Member | undefined;
    if (!person || person.deletingAt) return false;
    const start = await prepareStartPackage(tx, db, personId, person, now, { actorId: "system:coaching-auto-start" });
    // Re-checked in the transaction: a check-in may have started it first.
    if (!start || start.startedAt >= now) return false;
    start.commit(); return true;
  });
}

/** A Freeze that ended by itself (14 days), or a request still pending when the coaching expiry passed. */
function freezeDue(record: ClientPackage, now: number) {
  const freeze = record.freeze;
  if (freeze?.status === "active" && freeze.startedAt !== null) return now >= freezeAutoEnd(freeze.startedAt);
  return freeze?.status === "requested" && record.coachingExpiresAt !== null && now >= record.coachingExpiresAt;
}

/** The client's started package that can take a Freeze action, read inside a transaction. */
async function freezable(tx: Transaction, db: Firestore, personId: string, now: number) {
  const rows = await tx.get(db.collection("coachingPackages").where("personId", "==", personId));
  return rows.docs.map(row => row.data() as ClientPackage).filter(row => !row.topUp && row.status === "active" && row.startedAt !== null && packageState(row, now).status !== "expired")
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];
}

/** Client: request (once per package, after it started) or end a Freeze. Unfreezing needs no approval. */
export async function changeFreeze(personId: string, action: unknown) {
  if (action !== "request-freeze" && action !== "unfreeze") throw new ApiError(400, "invalid-action");
  await settleDuePackages(personId);
  const db = adminDb();
  return db.runTransaction(async tx => {
    const now = Date.now(), record = await freezable(tx, db, personId, now);
    const ref = record && db.doc(`coachingPackages/${record.id}`);
    if (action === "request-freeze") {
      // Once per package: a rejected or dropped request never froze it, so the client may ask again.
      if (!record || ["requested", "active", "ended"].includes(record.freeze?.status ?? "")) throw new ApiError(409, "freeze-unavailable");
      tx.update(ref!, { freeze: { status: "requested", requestedAt: now, startedAt: null, endedAt: null, days: null } satisfies Freeze });
      return { ok: true, freeze: "requested" };
    }
    if (record?.freeze?.status !== "active" || record.freeze.startedAt === null) throw new ApiError(409, "not-frozen");
    const days = freezeDays(record.freeze.startedAt, Math.min(now, freezeAutoEnd(record.freeze.startedAt)));
    tx.update(ref!, { freeze: { ...record.freeze, status: "ended", endedAt: now, days }, coachingExpiresAt: record.coachingExpiresAt! + days * 86_400_000 });
    return { ok: true, freeze: "ended", days };
  });
}

/** Admin: pending Freeze requests, oldest first. */
export async function freezeRequests() {
  const db = adminDb(), rows = await db.collection("coachingPackages").where("status", "==", "active").get(), now = Date.now();
  const pending = rows.docs.map(row => row.data() as ClientPackage).filter(row => row.freeze?.status === "requested" && !freezeDue(row, now));
  return { requests: await Promise.all(pending.sort((a, b) => a.freeze!.requestedAt - b.freeze!.requestedAt).map(async row => ({
    packageRecordId: row.id, personId: row.personId, name: String((await db.doc(`persons/${row.personId}`).get()).data()?.name ?? ""),
    requestedAt: row.freeze!.requestedAt, coachingExpiresAt: row.coachingExpiresAt, ...packageState(row, now) }))) };
}

/** Admin approves (the Freeze starts today) or rejects a pending request; audited. */
export async function decideFreeze(adminId: string, body: Record<string, unknown>) {
  const id = documentId(body.packageRecordId);
  if (body.decision !== "approve" && body.decision !== "reject") throw new ApiError(400, "invalid-decision");
  const db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`coachingPackages/${id}`), record = (await tx.get(ref)).data() as ClientPackage | undefined, now = Date.now();
    if (!record || record.freeze?.status !== "requested" || freezeDue(record, now) || packageState(record, now).status === "expired") throw new ApiError(409, "freeze-request-unavailable");
    const approved = body.decision === "approve";
    // An approved Freeze cancels the client's unmarked sessions on the days it can cover (today and the next 13).
    const today = philippineDate(now), lastDay = addManilaDays(today, FREEZE_MAX_DAYS - 1);
    const [sessions, marks] = approved ? await Promise.all([tx.get(db.collection("coachBookings").where("personId", "==", record.personId)),
      tx.get(db.collection("sessionMarks").where("personId", "==", record.personId))]) : [null, null];
    const marked = new Set(marks?.docs.map(row => row.data() as SessionMark).filter(mark => !mark.undoneAt).map(mark => mark.bookingId));
    const cancelled = (sessions?.docs.map(row => row.data() as Booking) ?? [])
      .filter(row => !row.cancelledAt && row.date >= today && row.date <= lastDay && !marked.has(row.id)).sort((a, b) => a.date.localeCompare(b.date) || startOf(a) - startOf(b));
    for (const row of cancelled) tx.update(db.doc(`coachBookings/${row.id}`), { cancelledAt: now });
    tx.update(ref, { freeze: { ...record.freeze, status: approved ? "active" : "rejected", startedAt: approved ? now : null, endedAt: approved ? null : now } });
    appendAudit(tx, db, { actorId: adminId, action: approved ? "freeze-approved" : "freeze-rejected", entityType: "coachingPackage", entityId: id, personId: record.personId,
      operationId: `freeze-${approved ? "approve" : "reject"}-${id}`, before: { status: "requested" }, after: { status: approved ? "active" : "rejected" },
      reason: cancelled.length ? `${cancelled.length} sessions cancelled` : null, occurredAt: now });
    return { ok: true, cancelled: cancelled.map(row => ({ date: row.date, start: startOf(row) })) };
  });
}

/** What the check-in screen shows: the client's current package, and whether this visit started it. */
export async function checkinCoaching(personId: string, logId?: string) {
  const rows = await adminDb().collection("coachingPackages").where("personId", "==", personId).get(), now = Date.now();
  const records = rows.docs.map(row => row.data() as ClientPackage), current = currentPackage(records, now);
  if (!current) return null;
  return { status: current.status, sessionsLeft: current.sessionsLeft, coachingExpiresAt: current.record.coachingExpiresAt,
    started: !!logId && records.some(row => row.startedByLogId === logId), coachName: await coachNameFor(personId) };
}

/** What the members portal shows: visible packages and the client's latest package. */
export async function customerCoaching(personId: string) {
  await settleDuePackages(personId);
  const db = adminDb(), settings = await getCoachingSettings(), now = Date.now();
  const rows = await db.collection("coachingPackages").where("personId", "==", personId).get();
  const records = rows.docs.map(row => row.data() as ClientPackage), balance = currentPackage(records, now);
  const latest = records.filter(row => row.status !== "closed" && !row.topUp).sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
  return { packages: settings.packages.filter(item => item.visible), canBuy: !records.some(record => blocksNewPackage(record, now)), coachName: await coachNameFor(personId),
    topUpPriceMinor: settings.topUpPriceMinor, topUpValidityDays: settings.topUpValidityDays,
    // Every usable session, packages and top-ups together.
    sessionsLeft: balance?.sessionsLeft ?? 0,
    topUps: balance?.holdings.filter(row => row.record.topUp).map(row => ({ sessionsLeft: row.sessionsLeft, coachingExpiresAt: row.record.coachingExpiresAt })) ?? [],
    current: latest && { ...packageState(latest, now), sessions: latest.sessions + latest.topUpSessions,
      freeze: latest.freeze ? { status: latest.freeze.status, startedAt: latest.freeze.startedAt, endsBy: latest.freeze.startedAt ? freezeAutoEnd(latest.freeze.startedAt) : null, days: latest.freeze.days } : null,
      canRequestFreeze: !["requested", "active", "ended"].includes(latest.freeze?.status ?? "") && latest.status === "active" && packageState(latest, now).status !== "expired",
      validityDays: latest.validityDays, priceMinor: latest.priceMinor, approvedAt: latest.approvedAt, startedAt: latest.startedAt, coachingExpiresAt: effectiveExpiry(latest, now) } };
}
