import sharp from "sharp";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json } from "@/lib/server/rfid/http";
import { readPrivateImage } from "@/lib/server/private-images";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const bytes = await sharp(await readPrivateImage(request, true)).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const qrImage = `data:image/png;base64,${bytes.toString("base64")}`;
    if (qrImage.length > 120_000) throw new ApiError(413, "qr-image-too-detailed");
    return json({ qrImage });
  });
}
