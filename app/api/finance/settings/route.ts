import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getFinanceSettings, saveFinanceSettings } from "@/lib/server/finance-settings";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await getFinanceSettings()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await saveFinanceSettings(actorId, await readBody(request)));
  });
}
