import { requireCustomer } from "@/lib/server/customer-session";
import { readPrivateImage, saveProfileImage } from "@/lib/server/private-images";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { adminDb } from "@/lib/server/firebase-admin";
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
export async function PATCH(request: Request) {
  return handleApi(async () => {
    const { session, official } = await requireCustomer(request);
    const { x, y } = await readBody(request);
    const valid = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
    if (!valid(x) || !valid(y)) throw new ApiError(400, "invalid-photo-position");
    await adminDb().doc(`${official ? "persons" : "unverifiedPersons"}/${session.personId}`).update({ profileImagePosition: { x, y } });
    return json({ ok: true });
  });
}
