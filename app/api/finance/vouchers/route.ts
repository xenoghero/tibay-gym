import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { listVouchers, saveVoucher } from "@/lib/server/vouchers";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await listVouchers(new URL(request.url).searchParams)); });
}
export async function POST(request: Request) {
  return handleApi(async () => { const actor = await requireAdmin(request); return json(await saveVoucher(actor, await readBody(request, 8192))); });
}
