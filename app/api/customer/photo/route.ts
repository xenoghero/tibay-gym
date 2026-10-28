import { requireCustomer } from "@/lib/server/customer-session";
import { readPrivateImage, saveProfileImage } from "@/lib/server/private-images";
import { handleApi, json } from "@/lib/server/rfid/http";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    publicRateLimiter.consume(publicCaller(request), "image");
    await saveProfileImage(session.personId, await readPrivateImage(request), request.headers.get("x-operation-id"), `customer:${session.personId}`);
    return json({ ok: true });
  });
}
