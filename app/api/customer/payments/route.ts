import { requireCustomer } from "@/lib/server/customer-session";
import { adminDb } from "@/lib/server/firebase-admin";
import { ApiError, handleApi, json } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request), db = adminDb();
    let query = db.collection("paymentRequests").where("personId", "==", session.personId).orderBy("submittedAt", "desc").orderBy("__name__", "desc");
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor) {
      const snapshot = await db.doc(`paymentRequests/${documentId(cursor)}`).get();
      if (snapshot.data()?.personId !== session.personId) throw new ApiError(403, "customer-scope-required");
      query = query.startAfter(snapshot);
    }
    const rows = await query.limit(21).get(), page = rows.docs.slice(0, 20);
    return json({ requests: page.map(doc => {
      const data = doc.data();
      return { id: doc.id, status: data.status, amountMinor: data.amountMinor, method: data.method,
        submittedAt: data.submittedAt, rejectionReason: data.rejectionReason ?? null };
    }), nextCursor: rows.size > 20 ? page.at(-1)!.id : null });
  });
}
