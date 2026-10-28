import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { documentId } from "@/lib/server/rfid/validation";
import { adminDb } from "@/lib/server/firebase-admin";
import { supabaseAdmin } from "@/lib/server/supabase";
import { RECEIPT_TABLE } from "@/lib/server/receipt-store";
import { correctReceipt } from "@/lib/server/receipt-review";
import { extractOpenedReceipt } from "@/lib/server/receipt-extraction";
import { normalizeGcashReference } from "@/lib/finance/references";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const id = documentId(new URL(request.url).searchParams.get("id"));
    const result = await supabaseAdmin().from(RECEIPT_TABLE).select("*").eq("id", id).single();
    if (result.error) throw new ApiError(404, "receipt-unavailable");
    const review = (await adminDb().doc(`receiptReviews/${id}`).get()).data() ?? { reviewRevision: 0 };
    let reference: string | null = null;
    try { reference = normalizeGcashReference(review.confirmedReference ?? result.data.normalized_reference); } catch { /* Manual review required. */ }
    const claimed = reference ? (await adminDb().doc(`approvedGcashReferences/${reference}`).get()).data() : null;
    const reused = reference ? await supabaseAdmin().from(RECEIPT_TABLE).select("id,payment_request_id")
      .or(`normalized_reference.eq.${reference},corrected_reference.eq.${reference}`).neq("id", id).limit(10) : null;
    const db = adminDb(), personId = result.data.person_id;
    const retention = (await db.doc(`receiptRetention/${id}`).get()).data();
    const person = (await db.doc(`persons/${personId}`).get()).data() ?? (await db.doc(`unverifiedPersons/${personId}`).get()).data();
    const payment = (await db.doc(`paymentRequests/${result.data.payment_request_id}`).get()).data();
    if (!person || person.deletingAt || retention?.purgeState) { result.data.raw_text = null; result.data.private_object_path = null; }
    return json({ receipt: result.data, review, canExtract: payment?.status === "pending" && !!person && !person.deletingAt && !retention?.purgeState && !result.data.artifact_deleted_at,
      referenceAlreadyClaimed: !!claimed && claimed.paymentRequestId !== result.data.payment_request_id,
      otherReceiptsUsingReference: reused?.data?.length ?? 0 });
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request), body = await readBody(request, 4096);
    if (body.action === "extract") {
      if (body.force !== undefined && typeof body.force !== "boolean") throw new ApiError(400, "invalid-extraction-request");
      return json(await extractOpenedReceipt(body.receiptId, body.force === true));
    }
    if (body.action !== undefined) throw new ApiError(400, "invalid-receipt-action");
    return json(await correctReceipt(actorId, body));
  });
}
