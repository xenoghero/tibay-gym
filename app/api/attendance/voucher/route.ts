import { createHash } from "node:crypto";
import { adminDb } from "@/lib/server/firebase-admin";
import { previewVoucher } from "@/lib/server/vouchers";
import { snapshotRate } from "@/lib/finance/rules";
import type { GymSettings } from "@/lib/finance/contracts";
import { attendancePhone } from "@/lib/server/attendance-request";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { sameOrigin } from "@/lib/server/customer-session";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { dailyChargeId } from "@/lib/server/daily-charges";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    sameOrigin(request); publicRateLimiter.consume(publicCaller(request), "lookup");
    const body = await readBody(request), phone = attendancePhone(body.phone), db = adminDb();
    let rows = await db.collection("persons").where("phone", "==", phone).limit(1).get();
    if (rows.empty) rows = await db.collection("unverifiedPersons").where("phone", "==", phone).limit(1).get();
    const person = rows.docs[0]?.data(), at = Date.now();
    if (person?.deletingAt) throw new ApiError(409, "person-unavailable");
    const personId = rows.docs[0]?.id ?? `preview-${createHash("sha256").update(phone).digest("hex")}`;
    if (person && (await db.doc(`charges/${dailyChargeId(personId, at)}`).get()).exists) throw new ApiError(409, "daily-payment-already-submitted");
    const settings = (await db.doc("gymSettings/finance").get()).data() as GymSettings | undefined;
    if (!settings?.financialCutoverAt || settings.financialCutoverAt > at) throw new ApiError(409, "finance-not-enabled");
    let price;
    try { price = snapshotRate(settings, person ? person.rateCategory : body.category, "daily_session"); } catch { throw new ApiError(409, "category-required"); }
    return json({ ...await previewVoucher({ code: body.voucherCode, personId, kind: "daily_session", category: price.categorySnapshot,
      baseAmountMinor: price.amountMinor, at }), rateRevision: price.rateRevision });
  });
}
