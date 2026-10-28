import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import type { CustomerSession } from "@/lib/finance/contracts";
import { publicCaller, publicRateLimiter } from "./public-rate-limit";
export const CUSTOMER_COOKIE = "tibay_customer";
export const CUSTOMER_SESSION_MS = 30 * 60_000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
function customerToken(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${CUSTOMER_COOKIE}=`))?.slice(CUSTOMER_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
/** Revocation also works after profile removal or expiry, without returning profile information. */
export async function revokeCustomerSession(request: Request) {
  const token = customerToken(request);
  if (!token) return;
  const db = adminDb(), ref = db.doc(`customerSessions/${hash(token)}`);
  await db.runTransaction(async tx => {
    const session = (await tx.get(ref)).data();
    if (session && session.revokedAt === null) tx.update(ref, { revokedAt: Date.now() });
  });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, "origin-required");
}
export function sessionCookie(token: string, maxAge = CUSTOMER_SESSION_MS / 1000) {
  return `${CUSTOMER_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export async function createCustomerSession(phone: string) {
  const db = adminDb();
  const official = await db.collection("persons").where("phone", "==", phone).limit(2).get();
  const pending = await db.collection("unverifiedPersons").where("phone", "==", phone).limit(2).get();
  const matches = [...official.docs, ...pending.docs];
  if (matches.length !== 1 || matches[0].data().deletingAt) throw new ApiError(404, "customer-unavailable");
  const token = randomBytes(32).toString("base64url");
  const opaqueSessionHash = hash(token), createdAt = Date.now();
  const session: CustomerSession = { opaqueSessionHash, personId: matches[0].id, createdAt, expiresAt: createdAt + CUSTOMER_SESSION_MS, revokedAt: null, scope: "renewal-and-status" };
  await db.doc(`customerSessions/${opaqueSessionHash}`).set(session);
  return { token, expiresAt: session.expiresAt };
}
export async function requireCustomer(request: Request) {
  sameOrigin(request);
  publicRateLimiter.consume(publicCaller(request), "customer");
  const token = customerToken(request);
  if (!token) throw new ApiError(401, "customer-session-required");
  const session = (await adminDb().doc(`customerSessions/${hash(token)}`).get()).data() as CustomerSession | undefined;
  if (!session || session.scope !== "renewal-and-status" || session.revokedAt !== null || session.expiresAt <= Date.now()) throw new ApiError(401, "customer-session-expired");
  const db = adminDb();
  const official = (await db.doc(`persons/${session.personId}`).get()).data();
  const person = official ?? (await db.doc(`unverifiedPersons/${session.personId}`).get()).data();
  if (!person || person.deletingAt) throw new ApiError(401, "customer-unavailable");
  return { session, person, official: !!official };
}
