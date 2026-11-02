import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { getPromotionSettings, savePromotionSettings, uploadPromotion } from "@/lib/server/promotions";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => { await requireAdmin(request); return json(await getPromotionSettings()); });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await savePromotionSettings(actorId, await readBody(request, 8192)));
  });
}
export async function PUT(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    return json(await uploadPromotion(actorId, request));
  });
}
