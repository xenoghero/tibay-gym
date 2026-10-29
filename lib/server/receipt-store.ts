import "server-only";
import { createHash, createHmac } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { ApiError } from "./rfid/http";
import { dailyChargeId } from "./daily-charges";
import { operationId, philippineDate, snapshotRate } from "@/lib/finance/rules";
import type { GymSettings } from "@/lib/finance/contracts";
import { purchaseChargeId, purchaseRequestId } from "./purchases";
import type { Charge } from "@/lib/finance/contracts";
import { previewVoucher } from "./vouchers";
export const RECEIPT_BUCKET = "payment-receipts";
export const RECEIPT_TABLE = "tibay_receipts";
export interface ReceiptRecord {
  id: string; payment_request_id: string; charge_id: string; person_id: string; private_object_path: string; upload_digest: string;
  uploaded_at: string; linked_at: string | null; purge_after: string | null;
  ocr_status: "queued" | "processing" | "extracted" | "needs_review" | "failed";
  extracted_reference: string | null; normalized_reference: string | null; extracted_amount_minor: number | null;
  raw_text: string | null; confidence: number | null; error_code: string | null; attempt_count: number;
  claim_token: string | null; lease_until: string | null; corrected_reference: string | null; corrected_amount_minor: number | null;
  corrected_by: string | null; corrected_at: string | null; correction_revision: number;
  artifact_deleted_at: string | null;
  processed_at: string | null;
}
export async function receiptsAvailable() {
  try { const result = await supabaseAdmin().rpc("tibay_receipt_ready"); return !result.error && result.data === true; }
  catch { return false; }
}
export async function uploadDailyReceipt(input: { personId: string; category: unknown; operationId: unknown; expectedAmountMinor: number; bytes: Buffer; registration?: boolean;
  kind?: Charge["kind"]; previousRequestId?: string; voucherCode?: string }) {
  let operation: string;
  try { operation = operationId(input.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  if (!await receiptsAvailable()) throw new ApiError(503, "receipt-storage-not-ready");
  const db = adminDb(), supabase = supabaseAdmin(), now = Date.now();
  const settings = (await db.doc("gymSettings/finance").get()).data() as GymSettings | undefined;
  if (!settings?.financialCutoverAt || settings.financialCutoverAt > now) throw new ApiError(409, "finance-not-enabled");
  let kind = input.kind ?? "daily_session", previous: Charge | null = null;
  if (input.previousRequestId) {
    const request = (await db.doc(`paymentRequests/${input.previousRequestId}`).get()).data();
    if (!request || request.personId !== input.personId || request.status !== "rejected") throw new ApiError(409, "replacement-unavailable");
    previous = (await db.doc(`charges/${request.chargeId}`).get()).data() as Charge;
    if (!previous || previous.abandonedAt || previous.confirmedPaymentRequestId || previous.activePaymentRequestId !== input.previousRequestId) throw new ApiError(409, "replacement-unavailable");
    kind = previous.kind;
  }
  if (kind !== "daily_session") {
    const person = (await db.doc(`persons/${input.personId}`).get()).data();
    if (!person || person.deletingAt) throw new ApiError(409, "verified-profile-required");
    if (!previous && kind !== (person.type === "member" ? "renewal" : "new_membership")) throw new ApiError(409, "purchase-quote-changed");
  }
  let price;
  try { price = previous ?? snapshotRate(settings, input.category, kind); } catch { throw new ApiError(409, "category-required"); }
  if (!previous && input.voucherCode) price = { ...price, ...await previewVoucher({ code: input.voucherCode, personId: input.personId,
    kind, category: price.categorySnapshot, baseAmountMinor: price.amountMinor, at: now }) };
  if (price.amountMinor !== input.expectedAmountMinor) throw new ApiError(409, "daily-price-changed");
  const id = createHash("sha256").update(JSON.stringify([input.personId, operation])).digest("hex");
  const chargeId = previous?.id ?? (kind === "daily_session" ? dailyChargeId(input.personId, now) : purchaseChargeId(input.personId, operation));
  const paymentRequestId = kind === "daily_session" && !previous ? `${chargeId}-g-${id.slice(0, 16)}` : purchaseRequestId(input.personId, operation);
  const path = `${input.personId}/${id}.webp`, digest = createHash("sha256").update(input.bytes).digest("hex");
  const token = createHmac("sha256", process.env.SUPABASE_SECRET_KEY!).update(`tibay-receipt:${id}`).digest("base64url");
  const inserted = await supabase.from(RECEIPT_TABLE).upsert({ id, payment_request_id: paymentRequestId, person_id: input.personId,
    charge_id: chargeId, private_object_path: path, upload_digest: digest, ocr_status: "needs_review" }, { onConflict: "id", ignoreDuplicates: true });
  if (inserted.error) throw new ApiError(503, "receipt-metadata-unavailable");
  const existing = await supabase.from(RECEIPT_TABLE).select("id,person_id,charge_id,payment_request_id,upload_digest,private_object_path,artifact_deleted_at").eq("id", id).single();
  if (existing.error || existing.data.person_id !== input.personId || existing.data.upload_digest !== digest || existing.data.charge_id !== chargeId ||
      existing.data.payment_request_id !== paymentRequestId || existing.data.private_object_path !== path) throw new ApiError(409, "receipt-operation-conflict");
  const retention = (await db.doc(`receiptRetention/${id}`).get()).data();
  if (existing.data.artifact_deleted_at || retention?.purgeState) throw new ApiError(409, "receipt-evidence-removed");
  if (!(await db.doc(`receiptIntents/${id}`).get()).data()?.linked) {
    const uploaded = await supabase.storage.from(RECEIPT_BUCKET).upload(path, input.bytes, { contentType: "image/webp", upsert: false });
    if (uploaded.error && String(uploaded.error.statusCode) !== "409") throw new ApiError(503, "receipt-upload-failed");
  }
  await db.runTransaction(async tx => {
    const ref = db.doc(`receiptIntents/${id}`), previous = (await tx.get(ref)).data();
    const official = (await tx.get(db.doc(`persons/${input.personId}`))).data();
    const pending = (await tx.get(db.doc(`unverifiedPersons/${input.personId}`))).data();
    const deleted = (await tx.get(db.doc(`deletedPersonIds/${input.personId}`))).data();
    if (deleted) throw new ApiError(409, "registration-reuse");
    if ((official ?? pending)?.deletingAt || (!input.registration && !official && !pending)) throw new ApiError(409, "person-unavailable");
    if (previous && (previous.digest !== digest || previous.chargeId !== chargeId || previous.personId !== input.personId || previous.amountMinor !== price.amountMinor)) throw new ApiError(409, "receipt-operation-conflict");
    if (previous?.linked) return;
    tx.set(ref, { personId: input.personId, chargeId, paymentRequestId, amountMinor: price.amountMinor, chargeDate: philippineDate(now),
      digest, path, tokenHash: createHash("sha256").update(token).digest("hex"), state: "ready", linked: false, reconciled: false,
      createdAt: previous?.createdAt ?? now, expiresAt: now + 86400000 });
  });
  return { receiptId: id, receiptToken: token };
}
/** Safe after an ambiguous attendance response: only the authoritative transaction can set linked. */
export async function reconcileReceiptLink(id: string) {
  const db = adminDb(), ref = db.doc(`receiptIntents/${id}`), intent = (await ref.get()).data();
  if (!intent?.linked || intent.reconciled) return;
  const result = await supabaseAdmin().from(RECEIPT_TABLE).update({ linked_at: new Date(intent.linkedAt).toISOString(), purge_after: null }).eq("id", id);
  if (result.error) throw new ApiError(503, "receipt-link-recovery-needed");
  await ref.update({ reconciled: true });
}
export async function recoverReceiptLinks() {
  const rows = await adminDb().collection("receiptIntents").where("linked", "==", true).where("reconciled", "==", false).limit(50).get();
  let recovered = 0;
  for (const row of rows.docs) { try { await reconcileReceiptLink(row.id); recovered++; } catch { /* Durable intent remains pending. */ } }
  return recovered;
}
export async function cleanupOrphanReceipts() {
  const supabase = supabaseAdmin();
  const result = await supabase.from(RECEIPT_TABLE).select("id,private_object_path").is("linked_at", null).lte("purge_after", new Date().toISOString()).limit(50);
  if (result.error) throw new ApiError(503, "receipt-cleanup-unavailable");
  let removed = 0;
  for (const row of result.data) {
    const intent = (await adminDb().doc(`receiptIntents/${row.id}`).get()).data();
    if (intent?.linked) { await reconcileReceiptLink(row.id); continue; }
    if (intent?.expiresAt > Date.now()) continue;
    const object = await supabase.storage.from(RECEIPT_BUCKET).remove([row.private_object_path]);
    if (object.error) continue;
    const deleted = await supabase.from(RECEIPT_TABLE).delete().eq("id", row.id).is("linked_at", null);
    if (deleted.error) continue;
    await adminDb().doc(`receiptIntents/${row.id}`).delete(); removed++;
  }
  return removed;
}
