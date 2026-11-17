import "server-only";
import { randomUUID } from "node:crypto";
import { adminAuth, adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { verifiedUid } from "./rfid/auth";
import { documentId } from "./rfid/validation";
import { appendAudit } from "./audit";

/** Server-only record keyed by the coach's Firebase user ID. Browser rules grant coaches nothing. */
export interface Coach { name: string; email: string; active: boolean; createdAt: number; deactivatedAt: number | null }

export async function requireCoach(request: Request): Promise<{ id: string; coach: Coach }> {
  const adminUid = process.env.FIREBASE_ADMIN_ALLOWED_UID;
  if (!adminUid) throw new Error("Allowed admin UID is not configured");
  const uid = await verifiedUid(request, "coach-auth");
  // The single admin identity is never a coach, whatever records exist.
  if (uid === adminUid) throw new ApiError(403, "coach-required");
  const coach = (await adminDb().doc(`coaches/${uid}`).get()).data() as Coach | undefined;
  if (!coach?.active) throw new ApiError(403, "coach-required");
  return { id: uid, coach };
}

const name = (value: unknown) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new ApiError(400, "invalid-coach-name");
  return value.trim();
};
const email = (value: unknown) => {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new ApiError(400, "invalid-coach-email");
  return value.trim().toLowerCase();
};
const password = (value: unknown) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new ApiError(400, "invalid-coach-password");
  return value;
};

export async function listCoaches() {
  const rows = await adminDb().collection("coaches").orderBy("createdAt").get();
  return { coaches: rows.docs.map(row => ({ id: row.id, ...(row.data() as Coach) })) };
}

export async function changeCoach(actorId: string, body: Record<string, unknown>) {
  if (body.action === "create") return createCoach(actorId, name(body.name), email(body.email), password(body.password));
  const coachId = documentId(body.coachId), db = adminDb(), ref = db.doc(`coaches/${coachId}`);
  const existing = (await ref.get()).data() as Coach | undefined;
  if (!existing) throw new ApiError(404, "coach-unavailable");
  if (body.action === "reset-password") {
    if (!existing.active) throw new ApiError(409, "coach-deactivated");
    await adminAuth().updateUser(coachId, { password: password(body.password) });
    await adminAuth().revokeRefreshTokens(coachId);
    await db.runTransaction(async tx => { appendAudit(tx, db, { actorId, action: "coach-password-reset", entityType: "coach", entityId: coachId, personId: null, operationId: randomUUID() }); });
    return { ok: true };
  }
  if (body.action === "deactivate") {
    // Disable the login first so a failed record write never leaves a usable account.
    await adminAuth().updateUser(coachId, { disabled: true });
    await adminAuth().revokeRefreshTokens(coachId);
    await db.runTransaction(async tx => {
      const coach = (await tx.get(ref)).data() as Coach;
      if (!coach.active) return;
      const now = Date.now();
      tx.update(ref, { active: false, deactivatedAt: now });
      appendAudit(tx, db, { actorId, action: "coach-deactivated", entityType: "coach", entityId: coachId, personId: null,
        operationId: `coach-deactivate-${coachId}`, before: { enabled: true }, after: { enabled: false }, occurredAt: now });
    });
    return { ok: true };
  }
  throw new ApiError(400, "invalid-coach-action");
}

async function createCoach(actorId: string, coachName: string, coachEmail: string, coachPassword: string) {
  let uid: string;
  try { uid = (await adminAuth().createUser({ email: coachEmail, password: coachPassword, displayName: coachName })).uid; }
  catch (error) {
    if ((error as { code?: unknown }).code === "auth/email-already-exists") throw new ApiError(409, "coach-email-taken");
    throw error;
  }
  if (uid === process.env.FIREBASE_ADMIN_ALLOWED_UID) throw new ApiError(409, "coach-email-taken");
  const db = adminDb(), now = Date.now();
  try {
    await db.runTransaction(async tx => {
      tx.set(db.doc(`coaches/${uid}`), { name: coachName, email: coachEmail, active: true, createdAt: now, deactivatedAt: null } satisfies Coach);
      appendAudit(tx, db, { actorId, action: "coach-created", entityType: "coach", entityId: uid, personId: null,
        operationId: `coach-create-${uid}`, after: { enabled: true }, occurredAt: now });
    });
  } catch (error) {
    // Without its record the login is unusable and would block a retry with the same email.
    await adminAuth().deleteUser(uid).catch(() => {});
    throw error;
  }
  return { id: uid };
}
