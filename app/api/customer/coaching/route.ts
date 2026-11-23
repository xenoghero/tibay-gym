import { requireCustomer } from "@/lib/server/customer-session";
import { changeFreeze, customerCoaching } from "@/lib/server/coaching";
import { memberSessions } from "@/lib/server/coach-bookings";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";

export const runtime = "nodejs";
/** The member's coaching package, or with ?month=YYYY-MM their Coaching sessions that month. */
export async function GET(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request), month = new URL(request.url).searchParams.get("month");
    return json(month === null ? await customerCoaching(session.personId) : await memberSessions(session.personId, month));
  });
}
/** Request a Freeze, or unfreeze without approval. */
export async function POST(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    return json(await changeFreeze(session.personId, (await readBody(request, 512)).action));
  });
}
