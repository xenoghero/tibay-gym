import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { assignCoach, coachAssignments } from "@/lib/server/coach-clients";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await coachAssignments()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await assignCoach(actorId, await readBody(request, 2048)));
  });
}
