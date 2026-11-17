import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { requireCoach } from "@/lib/server/coaches";
import { markSession, undoMark } from "@/lib/server/session-marks";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const { id } = await requireCoach(request), body = await readBody(request, 2048);
    if (body.action === "mark") return json(await markSession(id, body));
    if (body.action === "undo") return json(await undoMark({ coachId: id }, body));
    throw new ApiError(400, "invalid-action");
  });
}
