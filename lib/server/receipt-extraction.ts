import "server-only";
import { randomUUID } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { extractReceipt } from "./receipt-ocr";
import { RECEIPT_BUCKET, RECEIPT_TABLE, type ReceiptRecord } from "./receipt-store";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";

async function requireExtractable(row: ReceiptRecord) {
  const db = adminDb();
  const [intent, payment, retention, official, pending] = await Promise.all([
    db.doc(`receiptIntents/${row.id}`).get(), db.doc(`paymentRequests/${row.payment_request_id}`).get(),
    db.doc(`receiptRetention/${row.id}`).get(), db.doc(`persons/${row.person_id}`).get(),
    db.doc(`unverifiedPersons/${row.person_id}`).get(),
  ]);
  const link = intent.data(), request = payment.data(), person = official.data() ?? pending.data();
  if (!link?.linked || link.paymentRequestId !== row.payment_request_id || link.personId !== row.person_id || request?.receiptId !== row.id) throw new ApiError(409, "receipt-not-linked");
  if (row.artifact_deleted_at || retention.data()?.purgeState || !person || person.deletingAt) throw new ApiError(404, "receipt-unavailable");
  if (request.status !== "pending") throw new ApiError(409, "payment-not-pending");
}

async function projectExtraction(row: ReceiptRecord) {
  const db = adminDb(), ref = db.doc(`receiptReviews/${row.id}`);
  const completedAt = Date.parse(row.processed_at!);
  await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if ((previous?.ocrCompletedAt ?? 0) >= completedAt) return;
    tx.set(ref, { ...previous, personId: row.person_id, chargeId: row.charge_id, paymentRequestId: row.payment_request_id,
      ocrStatus: row.ocr_status, extractedReference: row.normalized_reference, extractedAmountMinor: row.extracted_amount_minor,
      confidence: row.confidence, reviewRevision: previous?.reviewRevision ?? 0, ocrCompletedAt: completedAt, updatedAt: Date.now() });
  });
}

/** Scan only the receipt opened by an authorized admin. No queue or scheduled OCR. */
export async function extractOpenedReceipt(receiptId: unknown, force = false) {
  const id = documentId(receiptId), supabase = supabaseAdmin();
  const stored = await supabase.from(RECEIPT_TABLE).select("*").eq("id", id).single();
  if (stored.error || !stored.data) throw new ApiError(404, "receipt-unavailable");
  const row = stored.data as ReceiptRecord;
  await requireExtractable(row);
  if (row.ocr_status === "processing" && row.lease_until && Date.parse(row.lease_until) > Date.now()) return { status: "processing" };
  if (!force && row.processed_at && row.ocr_status !== "processing" && row.ocr_status !== "failed" && row.ocr_status !== "queued") {
    await projectExtraction(row);
    return { status: row.ocr_status, cached: true };
  }
  const token = randomUUID();
  let claim = supabase.from(RECEIPT_TABLE).update({ ocr_status: "processing", claim_token: token,
    lease_until: new Date(Date.now() + 90_000).toISOString(), error_code: null, attempt_count: Math.min(row.attempt_count + 1, 3) })
    .eq("id", id).eq("ocr_status", row.ocr_status).eq("attempt_count", row.attempt_count).is("artifact_deleted_at", null);
  claim = row.claim_token ? claim.eq("claim_token", row.claim_token) : claim.is("claim_token", null);
  const claimed = await claim.select("id");
  if (claimed.error) throw new ApiError(503, "receipt-extraction-unavailable");
  if (claimed.data?.length !== 1) return { status: "processing" };

  let values: Partial<ReceiptRecord>;
  try {
    const image = await supabase.storage.from(RECEIPT_BUCKET).download(row.private_object_path);
    if (image.error) throw new Error("receipt-download-failed");
    const result = await extractReceipt(Buffer.from(await image.data.arrayBuffer()));
    values = { raw_text: result.text, confidence: result.confidence, extracted_reference: result.reference,
      normalized_reference: result.reference, extracted_amount_minor: result.amountMinor, ocr_status: result.status, error_code: null };
  } catch (error) {
    values = { ocr_status: "failed", error_code: error instanceof Error && error.message === "ocr-timeout" ? "ocr-timeout" : "ocr-failed",
      raw_text: null, confidence: null, extracted_reference: null, normalized_reference: null, extracted_amount_minor: null };
  }
  // Re-check access after the slow scan. Cleanup also fences writes by clearing the token.
  try { await requireExtractable(row); }
  catch (error) {
    await supabase.from(RECEIPT_TABLE).update({ ocr_status: "needs_review", claim_token: null, lease_until: null }).eq("id", id).eq("claim_token", token);
    throw error;
  }
  values = { ...values, processed_at: new Date().toISOString(), claim_token: null, lease_until: null };
  const finished = await supabase.from(RECEIPT_TABLE).update(values).eq("id", id).eq("claim_token", token)
    .eq("ocr_status", "processing").is("artifact_deleted_at", null).select("*");
  if (finished.error) throw new ApiError(503, "receipt-extraction-save-failed");
  if (finished.data?.length !== 1) throw new ApiError(409, "receipt-extraction-changed");
  await projectExtraction(finished.data[0] as ReceiptRecord);
  return { status: values.ocr_status, cached: false };
}
