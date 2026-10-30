import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { getPurchaseQuote, newProfileQuote, submitPurchase, abandonPurchase } from "@/lib/server/purchases";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request); const params = new URL(request.url).searchParams;
    return json(params.has("personId") ? await getPurchaseQuote(documentId(params.get("personId")), undefined, params.get("voucherCode") ?? undefined) : await newProfileQuote(params.get("category"), params.get("voucherCode") ?? undefined));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request), body = await readBody(request, 4096);
    if (body.action === "abandon") return json(await abandonPurchase(actorId, body));
    if (body.method !== "cash") throw new ApiError(400, "use-customer-gcash-upload");
    return json(await submitPurchase(actorId, documentId(body.personId), body));
  });
}
