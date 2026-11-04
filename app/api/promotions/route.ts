import { getPromotionSettings } from "@/lib/server/promotions";
import { handleApi, json } from "@/lib/server/rfid/http";

export const runtime = "nodejs";
export async function GET() {
  return handleApi(async () => {
    const settings = await getPromotionSettings();
    return json({ banners: settings.banners.filter(banner => banner.enabled).map(({ id, title, imageUrl }) => ({ id, title, imageUrl })) });
  });
}
