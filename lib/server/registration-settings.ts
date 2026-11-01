import "server-only";
import { adminDb } from "./firebase-admin";
import { registrationSettings } from "@/lib/registration-settings";
import { ApiError } from "./rfid/http";
import { onlyFields } from "./attendance-request";
import { appendAudit } from "./audit";

export async function getRegistrationSettings() {
  return registrationSettings((await adminDb().doc("gymSettings/registration").get()).data());
}

export async function saveRegistrationSettings(actorId: string, body: Record<string, unknown>) {
  onlyFields(body, ["requireVerification", "revision"]);
  if (typeof body.requireVerification !== "boolean" || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
    throw new ApiError(400, "invalid-body");
  const db = adminDb(), ref = db.doc("gymSettings/registration");
  return db.runTransaction(async tx => {
    const current = registrationSettings((await tx.get(ref)).data());
    if (current.revision !== body.revision) throw new ApiError(409, "settings-changed");
    const next = { requireVerification: body.requireVerification as boolean, revision: current.revision + 1 };
    tx.set(ref, { ...next, updatedAt: Date.now(), updatedBy: actorId });
    appendAudit(tx, db, { actorId, action: "registration-settings-update", entityType: "settings", entityId: "registration",
      personId: null, operationId: `registration-settings-${next.revision}`, before: { enabled: current.requireVerification },
      after: { enabled: next.requireVerification } });
    return next;
  });
}
