import { createCustomerSession, requireCustomer, revokeCustomerSession, sameOrigin, sessionCookie } from "@/lib/server/customer-session";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { attendancePhone } from "@/lib/server/attendance-request";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { effectiveMemberStatusAt } from "@/lib/member-status";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    sameOrigin(request); publicRateLimiter.consume(publicCaller(request), "customerLogin");
    const body = await readBody(request);
    const session = await createCustomerSession(attendancePhone(body.phone));
    await revokeCustomerSession(request);
    const response = json({ expiresAt: session.expiresAt });
    response.headers.set("Set-Cookie", sessionCookie(session.token)); return response;
  });
}
export async function DELETE(request: Request) {
  return handleApi(async () => {
    sameOrigin(request); publicRateLimiter.consume(publicCaller(request), "customer");
    await revokeCustomerSession(request);
    const response = json({ ok: true }); response.headers.set("Set-Cookie", sessionCookie("", 0)); return response;
  });
}
export async function GET(request: Request) {
  return handleApi(async () => {
    const { person, official, session } = await requireCustomer(request);
    return json({ rateCategory: person.rateCategory ?? null, type: person.type,
      status: effectiveMemberStatusAt({ type: person.type, status: person.status, membershipExpiry: person.membershipExpiry ?? null }, Date.now()),
      membershipExpiryMs: person.membershipExpiry?.toMillis() ?? null, verified: official, expiresAt: session.expiresAt });
  });
}
