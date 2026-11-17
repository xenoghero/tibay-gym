import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { changeCoach, listCoaches } from "@/lib/server/coaches";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await listCoaches()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await changeCoach(actorId, await readBody(request, 4096)));
  });
}
