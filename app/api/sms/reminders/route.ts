import { requireMaintenanceCaller } from "@/lib/server/maintenance-auth";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { scanSmsReminders } from "@/lib/server/sms-reminders";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  return handleApi(async () => { await requireMaintenanceCaller(request); return json(await scanSmsReminders()); }, "sms-reminders");
}
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await scanSmsReminders(true, new URL(request.url).searchParams.get("after") ?? undefined)); }, "sms-reminders-preview");
}
