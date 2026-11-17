import "server-only";
import { adminDb } from "./firebase-admin";
import { appendAudit } from "./audit";
import { DEFAULT_SMS_SETTINGS, type SmsContact, type SmsSettings } from "@/lib/sms/contracts";
import { eligibleContact } from "@/lib/sms/rules";
import { coachingReminder, dueReminders } from "@/lib/sms/reminders";
import { currentPackage, effectiveExpiry } from "@/lib/coaching/clocks";
import type { ClientPackage } from "@/lib/coaching/catalog";
import { settleDuePackages } from "./coaching";
import { getSmsSettings, newSmsMessage, smsKey } from "./sms";
import { smsProviderReady } from "./sms-provider";
import { documentId } from "./rfid/validation";

/** A bounded rotating roster scan; runs can repeat safely and never catch up missed expiry points. */
export async function scanSmsReminders(preview = false, after?: string) {
  const db = adminDb(), settings = await getSmsSettings();
  if (!preview && (!settings.enabled || !smsProviderReady())) return { disabled: true, examined: 0, queued: 0, due: 0, next: null };
  const cursorRef = db.doc("smsWorker/reminders");
  const cursor = preview ? after : (await cursorRef.get()).data()?.after;
  let query = db.collection("persons").orderBy("__name__").limit(50);
  if (typeof cursor === "string") query = query.startAfter(documentId(cursor));
  const rows = await query.get(); let queued = 0, due = 0;
  for (const row of rows.docs) {
    // Reading packages here saves due 15-day starts and Freeze ends first (ADR 0001: no separate job).
    if (!preview) await settleDuePackages(row.id);
    const now = Date.now();
    const result = await db.runTransaction(async tx => {
      const person = (await tx.get(row.ref)).data();
      const contact = (await tx.get(db.doc(`smsContacts/${row.id}`))).data() as SmsContact | undefined;
      const current = { ...DEFAULT_SMS_SETTINGS, ...(await tx.get(db.doc("gymSettings/sms"))).data() } as SmsSettings;
      const destination = eligibleContact(person, contact);
      if (!person || !destination || (!preview && !current.enabled)) return { queued: 0, due: 0 };
      const packages = (await tx.get(db.collection("coachingPackages").where("personId", "==", row.id))).docs.map(doc => doc.data() as ClientPackage);
      const coaching = (currentPackage(packages, now)?.holdings ?? []).filter(holding => holding.status === "active" && holding.record.coachingExpiresAt !== null)
        .map(holding => coachingReminder(row.id, { id: holding.record.id, expiresAt: effectiveExpiry(holding.record, now)!, sessionsLeft: holding.sessionsLeft, frozen: holding.frozen }, current, now))
        .filter(candidate => candidate !== null);
      const candidates = [...dueReminders(row.id, person, current, now), ...coaching];
      const refs = candidates.map(candidate => db.doc(`smsMessages/${smsKey(candidate.key)}`));
      const previous = await Promise.all(refs.map(ref => tx.get(ref)));
      if (preview) return { queued: 0, due: candidates.filter((_, index) => !previous[index].exists).length };
      let added = 0;
      candidates.forEach((candidate, index) => {
        if (previous[index].exists) return;
        const id = refs[index].id;
        tx.set(refs[index], { ...newSmsMessage(id, row.id, destination, candidate.text, candidate.purpose, now),
          scheduledAt: candidate.scheduledAt, expirySnapshot: candidate.expirySnapshot, reminderOffset: candidate.reminderOffset, lastVisitSnapshot: candidate.lastVisitSnapshot,
          ...(candidate.coachingPackageId ? { coachingPackageId: candidate.coachingPackageId } : {}) });
        appendAudit(tx, db, { actorId: "sms-scheduler", action: "sms-reminder-queued", entityType: "sms", entityId: id,
          personId: row.id, operationId: id, after: { kind: candidate.purpose } }); added++;
      });
      return { queued: added, due: candidates.length };
    });
    queued += result.queued; due += result.due;
  }
  const next = rows.size === 50 ? rows.docs.at(-1)!.id : null;
  if (!preview) await cursorRef.set({ after: next });
  return { disabled: false, examined: rows.size, queued, due, next };
}
