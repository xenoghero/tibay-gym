import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { appendAudit } from "./audit";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { operationId } from "@/lib/finance/rules";
import { DEFAULT_SMS_SETTINGS, type SmsContact, type SmsMessage, type SmsSettings } from "@/lib/sms/contracts";
import { eligibleContact, smsPhone, smsText, validateSmsSettings } from "@/lib/sms/rules";
import { lookupSms, sendSms, smsProviderReady } from "./sms-provider";
import { reminderStillCurrent } from "@/lib/sms/reminders";

export const smsKey = (value: string) => createHash("sha256").update(value).digest("hex");
function smsOperation(value: unknown) {
  try { return operationId(value); } catch { throw new ApiError(400, "invalid-operation-id"); }
}
export async function getSmsSettings(): Promise<SmsSettings> {
  return { ...DEFAULT_SMS_SETTINGS, ...(await adminDb().doc("gymSettings/sms").get()).data() };
}
export async function saveSmsSettings(actorId: string, body: Record<string, unknown>) {
  let settings: SmsSettings;
  try { settings = validateSmsSettings(body); } catch { throw new ApiError(400, "invalid-sms-settings"); }
  if (settings.enabled && !smsProviderReady()) throw new ApiError(409, "sms-provider-unconfigured");
  const id = smsOperation(body.operationId), db = adminDb(), digest = smsKey(JSON.stringify(settings));
  return db.runTransaction(async tx => {
    const ref = db.doc("gymSettings/sms"), receipt = db.doc(`smsOperations/${id}`);
    const current = { ...DEFAULT_SMS_SETTINGS, ...(await tx.get(ref)).data() };
    const prior = (await tx.get(receipt)).data();
    if (prior) { if (prior.actorId !== actorId || prior.digest !== digest) throw new ApiError(409, "operation-conflict"); return prior.result as SmsSettings; }
    if (current.revision !== settings.revision) throw new ApiError(409, "sms-settings-changed");
    const result = { ...settings, revision: settings.revision + 1 };
    tx.set(ref, result); tx.set(receipt, { actorId, digest, result });
    appendAudit(tx, db, { actorId, action: "sms-settings", entityType: "settings", entityId: "sms", personId: null, operationId: id,
      before: { enabled: current.enabled }, after: { enabled: result.enabled, changedFields: Object.keys(settings).filter(key => key !== "revision") } });
    return result;
  });
}
export async function saveSmsContact(actorId: string, body: Record<string, unknown>) {
  const personId = documentId(body.personId), id = smsOperation(body.operationId), db = adminDb();
  if (typeof body.permission !== "boolean" || typeof body.optedOut !== "boolean" || !Number.isInteger(body.revision)) throw new ApiError(400, "invalid-sms-contact");
  return db.runTransaction(async tx => {
    const person = (await tx.get(db.doc(`persons/${personId}`))).data();
    const ref = db.doc(`smsContacts/${personId}`), current = (await tx.get(ref)).data() as SmsContact | undefined;
    const receipt = db.doc(`smsOperations/${id}`), prior = (await tx.get(receipt)).data();
    const digest = smsKey(JSON.stringify([personId, body.permission, body.optedOut, body.revision]));
    if (prior) { if (prior.actorId !== actorId || prior.digest !== digest) throw new ApiError(409, "operation-conflict"); return prior.result as { revision: number }; }
    const phone = smsPhone(person?.phone);
    if (!person || person.deletingAt || !phone) throw new ApiError(409, "sms-person-unavailable");
    if ((current?.revision ?? 0) !== body.revision) throw new ApiError(409, "sms-contact-changed");
    const result: SmsContact = { permission: body.permission as boolean, optedOut: body.optedOut as boolean, phone,
      revision: Number(body.revision) + 1, updatedAt: Date.now() };
    tx.set(ref, result); tx.set(receipt, { actorId, digest, result: { revision: result.revision } });
    appendAudit(tx, db, { actorId, action: "sms-contact", entityType: "person", entityId: personId, personId, operationId: id,
      after: { changedFields: ["smsPermission", "smsOptOut"], enabled: result.permission && !result.optedOut } });
    return { revision: result.revision };
  });
}
export function newSmsMessage(id: string, personId: string, destination: string, text: string, purpose: SmsMessage["purpose"], now = Date.now()): SmsMessage {
  return { id, personId, destination, text, purpose, campaignId: null, status: "queued", scheduledAt: now, createdAt: now,
    attempts: 0, leaseUntil: 0, providerMessageId: id, providerState: null, errorCode: null, expirySnapshot: null,
    reminderOffset: null, lastVisitSnapshot: null, completedAt: null };
}
export async function queueSmsTest(actorId: string, body: Record<string, unknown>) {
  const personId = documentId(body.personId), id = smsKey(`test:${actorId}:${smsOperation(body.operationId)}`);
  let text: string; try { text = smsText(body.text); } catch { throw new ApiError(400, "invalid-sms-text"); }
  const db = adminDb();
  return db.runTransaction(async tx => {
    const person = (await tx.get(db.doc(`persons/${personId}`))).data();
    const contact = (await tx.get(db.doc(`smsContacts/${personId}`))).data() as SmsContact | undefined;
    const ref = db.doc(`smsMessages/${id}`), prior = (await tx.get(ref)).data() as SmsMessage | undefined;
    if (prior) { if (prior.personId !== personId || prior.text !== text) throw new ApiError(409, "operation-conflict"); return { id }; }
    const destination = eligibleContact(person, contact);
    if (!destination) throw new ApiError(409, "sms-contact-ineligible");
    tx.set(ref, { ...newSmsMessage(id, personId, destination, text, "test") });
    appendAudit(tx, db, { actorId, action: "sms-test-queued", entityType: "sms", entityId: id, personId, operationId: id });
    return { id };
  });
}
export async function smsHistory(after?: string) {
  const db = adminDb(); let query = db.collection("smsMessages").orderBy("__name__").limit(50);
  if (after) query = query.startAfter(documentId(after));
  const rows = await query.get();
  return { messages: rows.docs.map(row => { const message = row.data() as SmsMessage; return { ...message, destination: `••••${message.destination.slice(-4)}` }; }),
    next: rows.size === 50 ? rows.docs.at(-1)!.id : null };
}
export async function runSmsWorker() {
  if (!(await getSmsSettings()).enabled || !smsProviderReady()) return { disabled: true, processed: 0 };
  const db = adminDb();
  // Rotating bounded scan includes accepted messages for delivery polling, without composite indexes.
  const cursorRef = db.doc("smsWorker/scan"), cursor = (await cursorRef.get()).data()?.after;
  let query = db.collection("smsMessages").orderBy("__name__").limit(10);
  if (typeof cursor === "string") query = query.startAfter(cursor);
  const rows = await query.get(); let processed = 0;
  for (const row of rows.docs) {
    const now = Date.now();
    const claimed = await db.runTransaction(async tx => {
      const message = (await tx.get(row.ref)).data() as SmsMessage | undefined;
      if (!message) return null;
      const settings = { ...DEFAULT_SMS_SETTINGS, ...(await tx.get(db.doc("gymSettings/sms"))).data() };
      const person = (await tx.get(db.doc(`persons/${message.personId}`))).data();
      const contact = (await tx.get(db.doc(`smsContacts/${message.personId}`))).data() as SmsContact | undefined;
      if (!settings.enabled || message.leaseUntil > now || message.scheduledAt > now || ["delivered", "failed", "cancelled"].includes(message.status)) return null;
      const reconcile = message.status !== "queued";
      if (!reconcile && now - message.createdAt > 86_400_000) {
        tx.update(row.ref, { status: "cancelled", errorCode: "queue-expired", completedAt: now }); return null;
      }
      if (!reconcile && eligibleContact(person, contact) !== message.destination) {
        tx.update(row.ref, { status: "cancelled", errorCode: "contact-ineligible", completedAt: now }); return null;
      }
      if (!reconcile) {
        const reminder = reminderStillCurrent(message, person!, settings, now);
        if (reminder === "wait") return null;
        if (reminder === "obsolete") {
          tx.update(row.ref, { status: "cancelled", errorCode: "reminder-obsolete", completedAt: now });
          appendAudit(tx, db, { actorId: "sms-worker", action: "sms-reminder-cancelled", entityType: "sms", entityId: message.id,
            personId: message.personId, operationId: message.id, after: { status: "cancelled" } }); return null;
        }
      }
      if (!reconcile && message.attempts >= settings.maxAttempts) { tx.update(row.ref, { status: "failed", errorCode: "retry-limit", completedAt: now }); return null; }
      const next = { ...message, status: reconcile ? message.status : "sending", leaseUntil: now + 60_000,
        attempts: reconcile ? message.attempts : message.attempts + 1 } as SmsMessage;
      if (!reconcile) tx.set(db.doc(`smsAttempts/${message.id}_${next.attempts}_send`), {
        messageId: message.id, personId: message.personId, attemptNumber: next.attempts, attemptedAt: now,
        responseCode: null, outcome: "in-flight", providerState: null, reconciliation: false });
      tx.set(row.ref, { ...next }); return { message: next, reconcile, maxAttempts: settings.maxAttempts };
    });
    if (!claimed) continue;
    const { message, reconcile, maxAttempts } = claimed;
    const result = await (reconcile ? lookupSms(message) : sendSms(message));
    await db.runTransaction(async tx => {
      const current = (await tx.get(row.ref)).data() as SmsMessage | undefined;
      if (!current) return; // Profile deletion may remove private sending records while a request is in flight.
      if (current.leaseUntil !== message.leaseUntil || current.attempts !== message.attempts) return;
      let status: SmsMessage["status"] = "uncertain";
      if (result.outcome === "accepted") status = result.state === "Delivered" ? "delivered" : result.state === "Sent" ? "sent" : result.state === "Failed" ? "failed" : result.state === "Cancelled" ? "cancelled" : "accepted";
      if (!reconcile && result.outcome === "rejected") status = result.code === 429 && current.attempts < maxAttempts ? "queued" : "failed";
      const terminal = ["delivered", "failed", "cancelled"].includes(status);
      tx.update(row.ref, { status, leaseUntil: 0, providerState: result.state, scheduledAt: Date.now() + (status === "queued" ? 60_000 * 2 ** current.attempts : 300_000),
        errorCode: result.outcome === "accepted" ? null : result.outcome, completedAt: terminal ? Date.now() : null });
      tx.set(db.doc(`smsAttempts/${message.id}_${message.attempts}_${reconcile ? now : "send"}`), {
        messageId: message.id, personId: message.personId, attemptNumber: message.attempts, attemptedAt: now, responseCode: result.code, outcome: result.outcome, providerState: result.state, reconciliation: reconcile });
      appendAudit(tx, db, { actorId: "sms-worker", action: "sms-outcome", entityType: "sms", entityId: message.id,
        personId: message.personId, operationId: `${message.id}-${now}`, after: { status } });
    });
    processed++;
  }
  await cursorRef.set({ after: rows.size === 10 ? rows.docs.at(-1)!.id : null });
  return { disabled: false, processed };
}
