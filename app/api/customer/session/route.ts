import { createCustomerSession, requireCustomer, revokeCustomerSession, sameOrigin, sessionCookie } from "@/lib/server/customer-session";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { resolveAccountPhone } from "@/lib/server/attendance-request";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import { philippineDate } from "@/lib/finance/rules";
import { adminDb } from "@/lib/server/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const caller = publicCaller(request); sameOrigin(request); publicRateLimiter.consume(caller, "customerLogin");
    const body = await readBody(request);
    const session = await createCustomerSession(await resolveAccountPhone(body.phone, caller));
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
    const monthStart = Date.parse(`${philippineDate(Date.now()).slice(0, 7)}-01T00:00:00+08:00`);
    const visits = await adminDb().collection("attendanceLogs").where("personId", "==", session.personId)
      // desc matches the existing (personId, checkInAt DESC) index in firestore.indexes.json
      .where("checkInAt", ">=", Timestamp.fromMillis(monthStart)).orderBy("checkInAt", "desc").count().get();
    return json({ visitsThisMonth: visits.data().count, name: person.name, rateCategory: person.rateCategory ?? null, type: person.type,
      status: effectiveMemberStatusAt({ type: person.type, status: person.status, membershipExpiry: person.membershipExpiry ?? null }, Date.now()),
      membershipExpiryMs: person.membershipExpiry?.toMillis() ?? null, verified: official, expiresAt: session.expiresAt,
      hasPhoto: Boolean(person.profileImagePath), photoPosition: person.profileImagePosition ?? null });
  });
}
