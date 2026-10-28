import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getSmsSettings, queueSmsTest, runSmsWorker, saveSmsContact, saveSmsSettings, smsHistory } from "@/lib/server/sms";
import { smsProviderReady } from "@/lib/server/sms-provider";
import { adminDb } from "@/lib/server/firebase-admin";
import { documentId } from "@/lib/server/rfid/validation";
import { scanSmsReminders } from "@/lib/server/sms-reminders";
import { dispatchSmsCampaign, listSmsCampaigns, previewSmsCampaign, smsCampaignProgress } from "@/lib/server/sms-campaigns";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const url = new URL(request.url), after = url.searchParams.get("after");
    if (url.searchParams.get("view") === "campaigns") return json(await listSmsCampaigns(after ?? undefined));
    if (url.searchParams.get("view") === "campaign") return json(await smsCampaignProgress(documentId(url.searchParams.get("id"))));
    if (url.searchParams.get("view") === "reminders") return json(await scanSmsReminders(true, after ?? undefined));
    if (url.searchParams.get("view") === "contacts") {
      const db = adminDb(); let query = db.collection("persons").orderBy("__name__").limit(50);
      if (after) query = query.startAfter(documentId(after));
      const rows = await query.get();
      const contacts = await Promise.all(rows.docs.map(async person => ({ id: person.id, name: person.data().name,
        phone: person.data().phone, contact: (await db.doc(`smsContacts/${person.id}`).get()).data() ?? null })));
      return json({ contacts, next: rows.size === 50 ? rows.docs.at(-1)!.id : null });
    }
    if (url.searchParams.get("view") === "attempts") {
      const id = documentId(url.searchParams.get("id"));
      const rows = await adminDb().collection("smsAttempts").where("messageId", "==", id).limit(100).get();
      return json({ attempts: rows.docs.map(row => row.data()) });
    }
    return json({ settings: await getSmsSettings(), configured: smsProviderReady(), ...await smsHistory(after ?? undefined) });
  }, "sms-admin-read");
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actor = await requireAdmin(request), body = await readBody(request, 16_384);
    switch (body.action) {
      case "settings": return json(await saveSmsSettings(actor, body));
      case "contact": return json(await saveSmsContact(actor, body));
      case "test": return json(await queueSmsTest(actor, body));
      case "worker": return json(await runSmsWorker());
      case "reminders": return json(await scanSmsReminders());
      case "campaign-preview": return json(await previewSmsCampaign(actor, body));
      case "campaign-dispatch": return json(await dispatchSmsCampaign(actor, body));
      default: throw new ApiError(400, "invalid-sms-action");
    }
  }, "sms-admin-write");
}
