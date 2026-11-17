import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { adjustSessions, fixMark, monthlyCoachCounts, sessionHistory, undoMark } from "@/lib/server/session-marks";
import { clientPackageSummary } from "@/lib/server/coach-clients";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const params = new URL(request.url).searchParams, personId = params.get("personId");
    if (personId) return json({ history: await sessionHistory(personId), package: await clientPackageSummary(personId) });
    return json(await monthlyCoachCounts(params.get("month")));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const adminId = await requireAdmin(request), body = await readBody(request, 2048);
    if (body.action === "undo") return json(await undoMark({ adminId }, body));
    if (body.action === "fix") return json(await fixMark(adminId, body));
    if (body.action === "adjust") return json(await adjustSessions(adminId, body));
    throw new ApiError(400, "invalid-action");
  });
}
