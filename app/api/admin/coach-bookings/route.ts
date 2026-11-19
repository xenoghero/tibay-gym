import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { bookSession, cancelBooking, coachSchedule } from "@/lib/server/coach-bookings";

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
    const adminId = await requireAdmin(request), body = await readBody(request, 2048);
    if (body.action === "book") return json(await bookSession({ adminId }, body));
    if (body.action === "cancel") return json(await cancelBooking({ adminId }, body));
    throw new ApiError(400, "invalid-action");
  });
}
