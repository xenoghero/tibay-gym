import { requireMaintenanceCaller } from "@/lib/server/maintenance-auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { runSmsWorker } from "@/lib/server/sms";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  return handleApi(async () => { await requireMaintenanceCaller(request); return json(await runSmsWorker()); }, "sms-worker");
}
