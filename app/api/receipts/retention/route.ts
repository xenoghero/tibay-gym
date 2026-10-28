import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { readReceiptRetention, saveReceiptRetention } from "@/lib/server/receipt-retention";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    return json(await readReceiptRetention(documentId(new URL(request.url).searchParams.get("id"))));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await saveReceiptRetention(actorId, await readBody(request, 4096)));
  });
}
