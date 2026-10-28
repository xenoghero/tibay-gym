import { adminDb } from "@/lib/server/firebase-admin";
import { attendanceIntent, attendancePhone, onlyFields } from "@/lib/server/attendance-request";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import { dailyChargeId } from "@/lib/server/daily-charges";
import { snapshotRate } from "@/lib/finance/rules";
import type { GymSettings } from "@/lib/finance/contracts";
import { STALE_SESSION_MS } from "@/lib/server/attendance";
import { receiptsAvailable } from "@/lib/server/receipt-store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    publicRateLimiter.consume(publicCaller(request), "lookup");
    const body = await readBody(request, 4096);
    onlyFields(body, ["phone", "intent"]);
    const phone = attendancePhone(body.phone);
    const intent = attendanceIntent(body.intent);
    const db = adminDb();
    let snapshot = await db.collection("persons").where("phone", "==", phone).limit(1).get();
    let unverified = false;
    if (snapshot.empty) {
      snapshot = await db.collection("unverifiedPersons").where("phone", "==", phone).limit(1).get();
      unverified = !snapshot.empty;
    }
    const settings = (await db.doc("gymSettings/finance").get()).data() as GymSettings | undefined;
    const enabled = settings?.financialCutoverAt && settings.financialCutoverAt <= Date.now();
    const gcashAvailable = enabled ? await receiptsAvailable() : false;
    const pricing = enabled ? { dailyRates: { studentDailyMinor: settings.studentDailyMinor, regularDailyMinor: settings.regularDailyMinor, gcashAvailable } } : {};
    if (snapshot.empty) return json({ person: null, ...pricing });
    const doc = snapshot.docs[0];
    const person = doc.data();
    if (person.deletingAt != null) throw new ApiError(409, "person-unavailable");
    const result = { id: doc.id, name: person.name, type: person.type, status: person.status,
      membershipExpiryMs: person.membershipExpiry?.toMillis() ?? null, visitCount: person.visitCount,
      ...(unverified ? { unverified: true } : {}) };
    // Recheck the expected session inside the checkout transaction.
    if (intent === "checkout") {
      const state = (await db.doc(`${unverified ? "unverifiedAttendanceState" : "attendanceState"}/${doc.id}`).get()).data();
      return json({ person: result, expectedLogId: state?.openLogId ?? null });
    }
    if (enabled && (person.type !== "member" || effectiveMemberStatusAt({ type: person.type, status: person.status, membershipExpiry: person.membershipExpiry ?? null }, Date.now()) !== "active")) {
      const state = (await db.doc(`${unverified ? "unverifiedAttendanceState" : "attendanceState"}/${doc.id}`).get()).data();
      const open = state?.openLogId ? (await db.doc(`${unverified ? "unverifiedAttendanceLogs" : "attendanceLogs"}/${state.openLogId}`).get()).data() : null;
      const charge = (await db.doc(`charges/${dailyChargeId(doc.id, Date.now())}`).get()).data();
      if (!charge && (!open || open.checkOutAt !== null || Date.now() - open.checkInAt.toMillis() >= STALE_SESSION_MS)) {
        let amountMinor: number | null = null;
        try { amountMinor = snapshotRate(settings, person.rateCategory, "daily_session").amountMinor; } catch { /* Unclassified: admin action is required. */ }
        return json({ person: result, ...pricing, paymentDue: { amountMinor, expiredMember: person.type === "member", gcashAvailable } });
      }
    }
    return json({ person: result, ...pricing });
  }, "qr-lookup");
}
