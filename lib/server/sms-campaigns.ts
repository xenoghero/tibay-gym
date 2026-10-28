import "server-only";
import { adminDb } from "./firebase-admin";
import { appendAudit } from "./audit";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { operationId } from "@/lib/finance/rules";
import { eligibleContact, smsText } from "@/lib/sms/rules";
import type { SmsCampaign, SmsContact, SmsMessage } from "@/lib/sms/contracts";
import { newSmsMessage, smsKey } from "./sms";
function fingerprint(phone: string, contact: SmsContact) { return smsKey(JSON.stringify([phone, contact.revision ?? 0])); }
export async function previewSmsCampaign(actorId: string, body: Record<string, unknown>) {
  let text: string, operation: string;
  try { text = smsText(body.text); operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-campaign"); }
  if (!Array.isArray(body.personIds) || body.personIds.length < 1 || body.personIds.length > 100) throw new ApiError(400, "select-1-to-100-recipients");
  const ids = [...new Set(body.personIds.map(documentId))].sort(), db = adminDb();
  const id = smsKey(`campaign:${actorId}:${operation}`), digest = smsKey(JSON.stringify([text, ids]));
  return db.runTransaction(async tx => {
    const ref = db.doc(`smsCampaigns/${id}`), previous = (await tx.get(ref)).data();
    if (previous) {
      if (previous.digest !== digest || previous.createdBy !== actorId) throw new ApiError(409, "operation-conflict");
      return { id, count: previous.audienceSnapshot.length as number, excluded: ids.length - previous.audienceSnapshot.length, text: previous.messageSnapshot as string, personIds: previous.audienceSnapshot as string[] };
    }
    const people = await Promise.all(ids.map(personId => tx.get(db.doc(`persons/${personId}`))));
    const contacts = await Promise.all(ids.map(personId => tx.get(db.doc(`smsContacts/${personId}`))));
    const audienceSnapshot: string[] = [], audienceFingerprints: Record<string, string> = {}, destinations = new Set<string>();
    ids.forEach((personId, index) => {
      const contact = contacts[index].data() as SmsContact | undefined;
      const phone = eligibleContact(people[index].data(), contact);
      if (!phone || destinations.has(phone)) return;
      destinations.add(phone); audienceSnapshot.push(personId); audienceFingerprints[personId] = fingerprint(phone, contact!);
    });
    if (!audienceSnapshot.length) throw new ApiError(409, "no-eligible-recipients");
    const campaign: SmsCampaign = { id, createdBy: actorId, messageSnapshot: text, audienceSnapshot, audienceFingerprints,
      createdAt: Date.now(), dispatchRequestedAt: null };
    tx.set(ref, { ...campaign, digest });
    appendAudit(tx, db, { actorId, action: "sms-campaign-created", entityType: "smsCampaign", entityId: id, personId: null, operationId: id,
      after: { status: "draft" } });
    return { id, count: audienceSnapshot.length, excluded: ids.length - audienceSnapshot.length, text, personIds: audienceSnapshot };
  });
}
export async function dispatchSmsCampaign(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.campaignId), db = adminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(`smsCampaigns/${id}`), campaign = (await tx.get(ref)).data() as SmsCampaign | undefined;
    if (!campaign) throw new ApiError(404, "campaign-not-found");
    if (campaign.dispatchRequestedAt !== null) return { id, alreadyDispatched: true };
    const now = Date.now();
    if (now - campaign.createdAt > 30 * 60_000) throw new ApiError(409, "campaign-preview-expired");
    const ids = campaign.audienceSnapshot;
    const people = await Promise.all(ids.map(personId => tx.get(db.doc(`persons/${personId}`))));
    const contacts = await Promise.all(ids.map(personId => tx.get(db.doc(`smsContacts/${personId}`))));
    ids.forEach((personId, index) => {
      const contact = contacts[index].data() as SmsContact | undefined, person = people[index].data();
      const phone = eligibleContact(person, contact);
      // Deleted profiles get no new private message records. Progress derives their removed outcome.
      if (!person || person.deletingAt) return;
      const current = phone && fingerprint(phone, contact!) === campaign.audienceFingerprints[personId];
      const messageId = smsKey(`blast:${id}:${personId}`);
      const message = { ...newSmsMessage(messageId, personId, current ? phone : "", campaign.messageSnapshot, "blast", now), campaignId: id };
      tx.set(db.doc(`smsMessages/${messageId}`), { ...message, ...(!current ? { status: "cancelled", errorCode: "audience-changed", completedAt: now } : {}) });
    });
    tx.update(ref, { dispatchRequestedAt: now });
    appendAudit(tx, db, { actorId, action: "sms-campaign-dispatched", entityType: "smsCampaign", entityId: id, personId: null, operationId: id,
      after: { status: "dispatched" } });
    return { id, alreadyDispatched: false };
  });
}
export async function smsCampaignProgress(campaignId: string) {
  const id = documentId(campaignId), db = adminDb(), campaign = (await db.doc(`smsCampaigns/${id}`).get()).data() as SmsCampaign | undefined;
  if (!campaign) throw new ApiError(404, "campaign-not-found");
  const rows = await db.collection("smsMessages").where("campaignId", "==", id).limit(100).get();
  const messages = new Map(rows.docs.map(row => { const message = row.data() as SmsMessage; return [message.personId, message]; }));
  const recipients = campaign.audienceSnapshot.map(personId => ({ personId,
    status: messages.get(personId)?.status ?? (campaign.dispatchRequestedAt === null ? "draft" : "removed"),
    errorCode: messages.get(personId)?.errorCode ?? null, messageId: messages.get(personId)?.id ?? null }));
  const totals: Record<string, number> = {};
  for (const recipient of recipients) totals[recipient.status] = (totals[recipient.status] ?? 0) + 1;
  return { id, text: campaign.messageSnapshot, createdAt: campaign.createdAt, dispatchRequestedAt: campaign.dispatchRequestedAt,
    count: recipients.length, totals, recipients };
}
export async function listSmsCampaigns(after?: string) {
  let query = adminDb().collection("smsCampaigns").orderBy("__name__").limit(25);
  if (after) query = query.startAfter(documentId(after));
  const rows = await query.get();
  return { campaigns: rows.docs.map(row => { const campaign = row.data() as SmsCampaign; return {
    id: row.id, text: campaign.messageSnapshot, count: campaign.audienceSnapshot.length, createdAt: campaign.createdAt, dispatchRequestedAt: campaign.dispatchRequestedAt };
  }), next: rows.size === 25 ? rows.docs.at(-1)!.id : null };
}
