import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { decideFreeze, freezeRequests } from "@/lib/server/coaching";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await freezeRequests()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const adminId = await requireAdmin(request);
    return json(await decideFreeze(adminId, await readBody(request, 1024)));
  });
}
