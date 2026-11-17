import { requireCustomer } from "@/lib/server/customer-session";
import { changeFreeze, customerCoaching } from "@/lib/server/coaching";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    return json(await customerCoaching(session.personId));
  });
}
/** Request a Freeze, or unfreeze without approval. */
export async function POST(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    return json(await changeFreeze(session.personId, (await readBody(request, 512)).action));
  });
}
