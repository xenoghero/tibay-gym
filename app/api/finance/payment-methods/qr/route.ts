import sharp from "sharp";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json } from "@/lib/server/rfid/http";
import { readPrivateImage } from "@/lib/server/private-images";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const bytes = await sharp(await readPrivateImage(request, true)).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).png({ palette: true, colors: 256, compressionLevel: 9 }).toBuffer();
    const qrImage = `data:image/png;base64,${bytes.toString("base64")}`;
    return json({ qrImage });
  });
}
