import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { confirmDailyCash } from "@/lib/server/daily-charges";
import { documentId } from "@/lib/server/rfid/validation";
import { adminDb } from "@/lib/server/firebase-admin";
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
        charge.activePaymentRequestId ? db.doc(`paymentRequests/${charge.activePaymentRequestId}`).get() : null,
        db.doc(`persons/${charge.personId}`).get(),
      ]);
      const payment = paymentDoc?.data();
      const person = personDoc.data() ?? (await db.doc(`unverifiedPersons/${charge.personId}`).get()).data();
      return { ...charge, id: doc.id, customerName: person?.name ?? "Deleted customer", receiptId: payment?.receiptId ?? null, paymentMethod: payment?.method ?? null, paymentStatus: payment?.status ?? null };
    }));
    return json({ charges, nextCursor: rows.size > 50 ? page.at(-1)!.id : null });
  });
}
