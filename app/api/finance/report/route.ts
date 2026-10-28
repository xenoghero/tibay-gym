import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { financeReport } from "@/lib/server/finance-report";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await financeReport(new URL(request.url).searchParams)); });
}
