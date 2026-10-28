import { forceClose, repairVisits, deleteProfile } from "@/lib/server/attendance-admin";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    const body = await readBody(request);
    if (body.operation === "close") { await forceClose(documentId(body.logId), actorId); return json({ ok: true }); }
    const personId = documentId(body.personId);
    if (body.operation === "delete-profile") { await deleteProfile(personId, actorId); return json({ ok: true }); }
    if (body.operation === "delete-visit") return json(await repairVisits(personId, documentId(body.logId), false, actorId));
    if (body.operation === "repair") return json(await repairVisits(personId, undefined, false, actorId));
    if (body.operation === "delete-all-visits") return json(await repairVisits(personId, undefined, true, actorId));
    throw new ApiError(400, "invalid-operation");
  });
}
