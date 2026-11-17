import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
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
  if (rows.docs.some(row => row.id !== exceptId && blocksNewPackage(row.data() as ClientPackage))) throw new ApiError(409, "coaching-package-active");
}

/** What the members portal shows: visible packages and the client's latest package. */
export async function customerCoaching(personId: string) {
  const db = adminDb(), settings = await getCoachingSettings();
  const rows = await db.collection("coachingPackages").where("personId", "==", personId).get();
  const records = rows.docs.map(row => row.data() as ClientPackage);
  const latest = records.filter(row => row.status !== "closed").sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
  return { packages: settings.packages.filter(item => item.visible), canBuy: !records.some(blocksNewPackage),
    current: latest && { status: latest.status, sessions: latest.sessions, sessionsLeft: latest.sessions + latest.topUpSessions - latest.sessionsUsed,
      validityDays: latest.validityDays, priceMinor: latest.priceMinor, approvedAt: latest.approvedAt, startedAt: latest.startedAt, coachingExpiresAt: latest.coachingExpiresAt } };
}
