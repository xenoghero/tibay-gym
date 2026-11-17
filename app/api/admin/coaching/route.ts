import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getCoachingSettings, saveCoachingSettings } from "@/lib/server/coaching";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await getCoachingSettings()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await saveCoachingSettings(actorId, await readBody(request, 8192)));
  });
}
