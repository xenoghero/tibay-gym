import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { bookSession, cancelBooking, coachSchedule, updateSession } from "@/lib/server/coach-bookings";
import { markSession } from "@/lib/server/session-marks";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    return json(await coachSchedule(null, params.get("from"), params.get("to")));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    // Room for a full Exercise checklist with sets.
    const adminId = await requireAdmin(request), body = await readBody(request, 128 * 1024);
    if (body.action === "book") return json(await bookSession({ adminId }, body));
    if (body.action === "update") return json(await updateSession({ adminId }, body));
    if (body.action === "mark") return json(await markSession({ adminId }, body));
    if (body.action === "cancel") return json(await cancelBooking({ adminId }, body));
    throw new ApiError(400, "invalid-action");
  });
}
