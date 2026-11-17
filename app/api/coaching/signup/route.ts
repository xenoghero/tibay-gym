import { createCustomerSession, sameOrigin, sessionCookie } from "@/lib/server/customer-session";
import { createCoachingSignup } from "@/lib/server/coaching-signup";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";

export const runtime = "nodejs";
/** The one fixed Coaching sign-up link: creates the unverified profile, then the normal cookie-only portal session. */
export async function POST(request: Request) {
  return handleApi(async () => {
    const caller = publicCaller(request); sameOrigin(request);
    const body = await readBody(request, 4096);
    publicRateLimiter.consume(caller, "guest", JSON.stringify([body.operationId, body.phone]));
    const { personId, phone } = await createCoachingSignup(body);
    const session = await createCustomerSession(phone);
    const response = json({ personId, expiresAt: session.expiresAt });
    response.headers.set("Set-Cookie", sessionCookie(session.token));
    return response;
  }, "coaching-signup");
}
