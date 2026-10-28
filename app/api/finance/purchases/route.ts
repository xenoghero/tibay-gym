import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { getPurchaseQuote, newProfileQuote, submitPurchase } from "@/lib/server/purchases";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request); const params = new URL(request.url).searchParams;
    return json(params.has("personId") ? await getPurchaseQuote(documentId(params.get("personId"))) : await newProfileQuote(params.get("category")));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request), body = await readBody(request, 4096);
    if (body.method !== "cash") throw new ApiError(400, "use-customer-gcash-upload");
    return json(await submitPurchase(actorId, documentId(body.personId), body));
  });
}
