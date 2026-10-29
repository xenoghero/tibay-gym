import "server-only";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import sharp from "sharp";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { appendAudit } from "./audit";
import { operationId } from "@/lib/finance/rules";
import { accountSnapshot, isPaymentMethod, type PaymentAccount, type PaymentSettings } from "@/lib/finance/payment-methods";

export async function getPaymentSettings(): Promise<PaymentSettings> {
  return (await adminDb().doc("gymSettings/payments").get()).data() as PaymentSettings ?? { revision: 0, accounts: [] };
}
export async function customerPaymentAccounts() {
  return (await getPaymentSettings()).accounts.filter(account => account.enabled);
}
export async function customerPaymentOptions() {
  const settings = await getPaymentSettings();
  return { paymentRevision: settings.revision, paymentAccounts: settings.accounts.filter(account => account.enabled) };
}
/** Read within the payment transaction so disabling an account blocks new submissions. */
export async function preparePaymentAccount(tx: Transaction, db: Firestore, method: unknown, revision?: unknown) {
  if (!isPaymentMethod(method)) throw new ApiError(400, "invalid-payment-method");
  if (method === "cash") return null;
  const settings = (await tx.get(db.doc("gymSettings/payments"))).data() as PaymentSettings | undefined;
  // Legacy GCash submissions remain reviewable; new customers must choose a configured account.
  if (!settings && method === "gcash") return null;
  const account = settings?.accounts.find(account => account.id === method && account.enabled);
  if (!account || revision !== settings?.revision) throw new ApiError(409, "payment-method-unavailable");
  return accountSnapshot(account);
}
export async function savePaymentSettings(actorId: string, body: Record<string, unknown>) {
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  if (!Array.isArray(body.accounts) || body.accounts.length > 6) throw new ApiError(400, "invalid-payment-accounts");
  const accounts: PaymentAccount[] = [];
  for (const raw of body.accounts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "invalid-payment-accounts");
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== "string" || !/^account_[a-zA-Z0-9_-]{8,64}$/.test(value.id) || accounts.some(account => account.id === value.id) ||
      !["gcash", "maya", "bank"].includes(String(value.kind)) || typeof value.enabled !== "boolean") throw new ApiError(400, "invalid-payment-accounts");
    for (const field of ["name", "accountHolder", "accountNumber"] as const) {
      if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 100) throw new ApiError(400, "invalid-payment-accounts");
    }
    let qrImage: string | null = null;
    if (value.qrImage !== null && value.qrImage !== undefined) {
      if (typeof value.qrImage !== "string" || value.qrImage.length > 120_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.qrImage)) throw new ApiError(400, "invalid-qr-image");
      try {
        const bytes = await sharp(Buffer.from(value.qrImage.split(",")[1], "base64"), { limitInputPixels: 4_000_000 }).rotate()
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
        qrImage = `data:image/png;base64,${bytes.toString("base64")}`;
        if (qrImage.length > 120_000) throw new Error("Image too large");
      } catch { throw new ApiError(400, "invalid-qr-image"); }
    }
    accounts.push({ id: value.id as PaymentAccount["id"], kind: value.kind as PaymentAccount["kind"], name: String(value.name).trim(),
      accountHolder: String(value.accountHolder).trim(), accountNumber: String(value.accountNumber).trim(), enabled: value.enabled, qrImage });
  }
  const db = adminDb(), ref = db.doc("gymSettings/payments"), op = db.doc(`paymentSettingsOperations/${operation}`);
  const payload = createHash("sha256").update(JSON.stringify({ revision: body.revision, accounts })).digest("hex");
  return db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as PaymentSettings | undefined, prior = (await tx.get(op)).data();
    if (prior) {
      if (prior.actorId !== actorId || prior.payload !== payload) throw new ApiError(409, "operation-conflict");
      return { revision: prior.revision, accounts };
    }
    if (body.revision !== (current?.revision ?? 0)) throw new ApiError(409, "settings-changed");
    // Keep existing identities, including disabled accounts, for stable reference deduplication.
    if (current?.accounts.some(account => !accounts.some(next => next.id === account.id))) throw new ApiError(400, "disable-payment-account-instead");
    const settings = { revision: (current?.revision ?? 0) + 1, accounts };
    tx.set(ref, { ...settings, updatedAt: Date.now(), updatedBy: actorId });
    tx.set(op, { actorId, payload, revision: settings.revision });
    appendAudit(tx, db, { actorId, action: "payment-settings-updated", entityType: "settings", entityId: "payments", personId: null,
      operationId: operation, after: { revision: settings.revision, changedFields: ["paymentAccounts"] } });
    return settings;
  });
}
