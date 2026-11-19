import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { requireCoach } from "@/lib/server/coaches";
import { bookSession, cancelBooking, coachSchedule } from "@/lib/server/coach-bookings";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { id } = await requireCoach(request), params = new URL(request.url).searchParams;
    return json(await coachSchedule(id, params.get("from"), params.get("to")));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const { id } = await requireCoach(request), body = await readBody(request, 2048);
    if (body.action === "book") return json(await bookSession({ coachId: id }, body));
    if (body.action === "cancel") return json(await cancelBooking({ coachId: id }, body));
    throw new ApiError(400, "invalid-action");
  });
}
