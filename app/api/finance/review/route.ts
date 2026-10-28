import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { adminDb } from "@/lib/server/firebase-admin";
import { documentId } from "@/lib/server/rfid/validation";
import { decidePayment, paymentReviewPreview } from "@/lib/server/purchases";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request); const params = new URL(request.url).searchParams;
    if (params.has("id")) return json(await paymentReviewPreview(documentId(params.get("id"))));
    const kind = params.get("kind") ?? "membership";
    if (kind !== "membership" && kind !== "daily_session") throw new ApiError(400, "invalid-filter");
    const db = adminDb(); let query = db.collection("paymentRequests").orderBy("submittedAt", "desc").orderBy("__name__", "desc");
    const cursor = params.get("cursor");
    if (cursor) { const doc = await db.doc(`paymentRequests/${documentId(cursor)}`).get(); if (!doc.exists) throw new ApiError(400, "invalid-cursor"); query = query.startAfter(doc); }
    const rows = await query.limit(51).get(), page = rows.docs.slice(0, 50);
    const records = await Promise.all(page.map(async doc => {
      const payment = doc.data(), charge = (await db.doc(`charges/${payment.chargeId}`).get()).data();
      const person = (await db.doc(`persons/${payment.personId}`).get()).data() ?? (await db.doc(`unverifiedPersons/${payment.personId}`).get()).data();
      const review = payment.receiptId ? (await db.doc(`receiptReviews/${payment.receiptId}`).get()).data() : null;
      return { payment: { ...payment, id: doc.id }, charge, customer: { id: payment.personId, name: person?.name ?? "Deleted customer" },
        gcashReference: review?.confirmedReference ?? review?.extractedReference ?? payment.gcashReferenceSnapshot ?? null };
    }));
    return json({ records: records.filter(row => kind === "daily_session" ? row.charge?.kind === "daily_session" : row.charge?.kind !== "daily_session"), nextCursor: rows.size > 50 ? page.at(-1)!.id : null });
  });
}
export async function POST(request: Request) {
  return handleApi(async () => json(await decidePayment(await requireAdmin(request), await readBody(request, 4096))));
}
