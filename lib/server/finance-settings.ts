import "server-only";
import { adminDb } from "./firebase-admin";
import { DEFAULT_SETTINGS, operationId, validateRates } from "@/lib/finance/rules";
import type { GymSettings } from "@/lib/finance/contracts";
import { ApiError } from "./rfid/http";
import { appendAudit } from "./audit";

export async function getFinanceSettings(): Promise<GymSettings> {
  const data = (await adminDb().doc("gymSettings/finance").get()).data();
  return data ? data as GymSettings : { ...DEFAULT_SETTINGS };
}
export async function saveFinanceSettings(actorId: string, body: Record<string, unknown>) {
  let rates, id;
  try { rates = validateRates(body); id = operationId(body.operationId); }
  catch { throw new ApiError(400, "invalid-rates"); }
  const db = adminDb();
  const ref = db.doc("gymSettings/finance");
  const receipt = db.doc(`financeOperations/${id}`);
  const now = Date.now();
  return db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data() as GymSettings | undefined;
    const prior = (await tx.get(receipt)).data();
    if (prior) {
      if (prior.actorId !== actorId || JSON.stringify(prior.rates) !== JSON.stringify(rates)) throw new ApiError(409, "operation-conflict");
      return prior.settings as GymSettings;
    }
    const current = previous ?? { ...DEFAULT_SETTINGS };
    if (body.rateRevision !== current.rateRevision) throw new ApiError(409, "settings-changed");
    const settings: GymSettings = { ...DEFAULT_SETTINGS, ...rates, rateRevision: current.rateRevision + 1,
      financialCutoverAt: current.financialCutoverAt ?? now, updatedAt: now, updatedBy: actorId };
    tx.set(ref, settings);
    tx.set(receipt, { actorId, rates, settings, createdAt: now });
    appendAudit(tx, db, { actorId, action: "rates-update", entityType: "settings", entityId: "finance", personId: null,
      operationId: id, before: { ...current }, after: { ...settings } });
    return settings;
  });
}
