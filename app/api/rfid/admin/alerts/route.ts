import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { dismissRejectedMemberTap } from "@/lib/server/rfid/rejection-alerts";
import { documentId } from "@/lib/server/rfid/validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    const body = await readBody(request);
    await dismissRejectedMemberTap(documentId(body.eventId), actorId);
    return json({ dismissed: true });
  });
}
