import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { confirmDailyCash } from "@/lib/server/daily-charges";
import { documentId } from "@/lib/server/rfid/validation";
import { adminDb } from "@/lib/server/firebase-admin";
import type { PaymentRequest } from "@/lib/finance/contracts";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request), body = await readBody(request);
    if (body.reviewed !== true) throw new ApiError(400, "cash-review-required");
    return json(await confirmDailyCash(actorId, documentId(body.chargeId), body.expectedAmountMinor));
  });
}
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const db = adminDb();
    const params = new URL(request.url).searchParams;
    if (params.has("chargeId")) {
      const chargeId = documentId(params.get("chargeId"));
      const charge = (await db.doc(`charges/${chargeId}`).get()).data();
      if (charge?.kind !== "daily_session") throw new ApiError(404, "daily-charge-unavailable");
      const rows = await db.collection("paymentRequests").where("chargeId", "==", chargeId).get();
      const payments = rows.docs.map(doc => ({ ...doc.data(), id: doc.id }) as PaymentRequest);
      payments.sort((a, b) => Number(b.submittedAt) - Number(a.submittedAt) || b.id.localeCompare(a.id));
      return json({ payments });
    }
    let query = db.collection("charges").where("kind", "==", "daily_session").orderBy("createdAt", "desc").orderBy("__name__", "desc");
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor) {
      const doc = await db.doc(`charges/${documentId(cursor)}`).get();
      if (doc.data()?.kind !== "daily_session") throw new ApiError(400, "invalid-cursor");
      query = query.startAfter(doc);
    }
    const rows = await query.limit(51).get(), page = rows.docs.slice(0, 50);
    const charges = await Promise.all(page.map(async doc => {
      const charge = doc.data();
      const [paymentDoc, personDoc] = await Promise.all([
        (charge.confirmedPaymentRequestId ?? charge.activePaymentRequestId) ? db.doc(`paymentRequests/${charge.confirmedPaymentRequestId ?? charge.activePaymentRequestId}`).get() : null,
        db.doc(`persons/${charge.personId}`).get(),
      ]);
      const payment = paymentDoc?.data();
      const review = payment?.receiptId ? (await db.doc(`receiptReviews/${payment.receiptId}`).get()).data() : null;
      const person = personDoc.data() ?? (await db.doc(`unverifiedPersons/${charge.personId}`).get()).data();
      return { ...charge, id: doc.id, customerName: person?.name ?? "Deleted customer", receiptId: payment?.receiptId ?? null, paymentMethod: payment?.method ?? null, paymentStatus: payment?.status ?? null,
        gcashReference: review?.confirmedReference ?? review?.extractedReference ?? payment?.gcashReferenceSnapshot ?? null };
    }));
    return json({ charges, nextCursor: rows.size > 50 ? page.at(-1)!.id : null });
  });
}
