import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getPaymentSettings, savePaymentSettings } from "@/lib/server/payment-methods";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await getPaymentSettings()); });
}
export async function POST(request: Request) {
  return handleApi(async () => { const actor = await requireAdmin(request); return json(await savePaymentSettings(actor, await readBody(request, 800_000))); });
}
