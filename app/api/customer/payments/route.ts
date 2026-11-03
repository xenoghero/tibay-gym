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
    async function project(id: string, data: Record<string, unknown>) {
      const charge = data.chargeId ? (await db.doc(`charges/${data.chargeId}`).get()).data() : undefined;
      return { id, status: data.status, amountMinor: data.amountMinor, method: data.method,
        kind: charge?.kind === "daily_session" || charge?.kind === "new_membership" || charge?.kind === "renewal" ? charge.kind : null,
        ...(data.paymentAccountSnapshot ? { paymentAccountSnapshot: data.paymentAccountSnapshot } : {}), submittedAt: data.submittedAt, rejectionReason: data.rejectionReason ?? null,
        ...(charge?.abandonedAt ? { closed: true } : {}),
        ...(charge?.voucherSnapshot ? { voucherCode: charge.voucherSnapshot.code, discountAmountMinor: charge.discountAmountMinor, baseAmountMinor: charge.baseAmountMinor } : {}) };
    }
    // The pending membership may be older than the latest page of daily payments.
    const purchaseState = (await db.doc(`membershipPurchaseState/${session.personId}`).get()).data();
    const pending = typeof purchaseState?.activeRequestId === "string"
      ? await db.doc(`paymentRequests/${documentId(purchaseState.activeRequestId)}`).get() : null;
    const pendingData = pending?.data();
    const candidate = pending && pendingData?.personId === session.personId && pendingData.status === "pending"
      ? await project(pending.id, pendingData) : null;
    const pendingMembership = candidate && !candidate.closed && (candidate.kind === "new_membership" || candidate.kind === "renewal") ? candidate : null;
    return json({ requests: await Promise.all(page.map(doc => project(doc.id, doc.data()))), pendingMembership,
      nextCursor: rows.size > 20 ? page.at(-1)!.id : null });
  });
}
