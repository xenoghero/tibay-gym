import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getRegistrationSettings, saveRegistrationSettings } from "@/lib/server/registration-settings";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await getRegistrationSettings()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await saveRegistrationSettings(actorId, await readBody(request, 1024)));
  });
}
