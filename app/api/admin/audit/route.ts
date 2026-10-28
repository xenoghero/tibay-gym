import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json } from "@/lib/server/rfid/http";
import { adminDb } from "@/lib/server/firebase-admin";
import { documentId } from "@/lib/server/rfid/validation";
import { philippineDate } from "@/lib/finance/rules";
import type { Query } from "firebase-admin/firestore";
export const runtime = "nodejs";
/** Bounded server queries, with combined filters backed by declared indexes. */
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    let query: Query = adminDb().collection("auditEvents");
    for (const field of ["action", "personId", "entityId"] as const) {
      const value = params.get(field);
      if (value) query = query.where(field, "==", documentId(value));
    }
    for (const [field, op, suffix] of [["from", ">=", "T00:00:00+08:00"], ["through", "<=", "T23:59:59.999+08:00"]] as const) {
      const value = params.get(field);
      if (!value) continue;
      const time = Date.parse(value + suffix);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || philippineDate(time) !== value) throw new ApiError(400, "invalid-date");
      query = query.where("occurredAt", op, time);
    }
    query = query.orderBy("occurredAt", "desc").orderBy("__name__", "desc");
    const cursor = params.get("cursor");
    if (cursor) {
      const doc = await adminDb().doc(`auditEvents/${documentId(cursor)}`).get();
      if (!doc.exists) throw new ApiError(400, "invalid-cursor");
      query = query.startAfter(doc);
    }
    const rows = await query.limit(51).get();
    const page = rows.docs.slice(0, 50);
    return json({ events: page.map(doc => ({ ...doc.data(), id: doc.id })), nextCursor: rows.size > 50 ? page.at(-1)!.id : null });
  });
}
