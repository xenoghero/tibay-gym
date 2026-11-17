import { requireCustomer } from "@/lib/server/customer-session";
import { customerCoaching } from "@/lib/server/coaching";
import { handleApi, json } from "@/lib/server/rfid/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    return json(await customerCoaching(session.personId));
  });
}
