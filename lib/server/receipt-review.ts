import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { RECEIPT_TABLE } from "./receipt-store";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { operationId } from "@/lib/finance/rules";
import { normalizeGcashReference } from "@/lib/finance/references";
import { appendAudit } from "./audit";
export async function correctReceipt(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.receiptId);
  let operation: string, reference: string;
  try { operation = operationId(body.operationId); reference = normalizeGcashReference(body.reference); } catch { throw new ApiError(400, "invalid-reference"); }
  if (typeof body.amountMinor !== "number" || !Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0 || body.amountMinor > 100_000_000) throw new ApiError(400, "invalid-amount");
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) throw new ApiError(400, "review-reason-required");
  const reason = body.reason.trim();
  const db = adminDb(), ref = db.doc(`receiptReviews/${id}`), receipt = db.doc(`receiptCorrectionOperations/${operation}`);
  const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const revision = await db.runTransaction(async tx => {
    const prior = (await tx.get(receipt)).data(), intent = (await tx.get(db.doc(`receiptIntents/${id}`))).data();
    const previous = (await tx.get(ref)).data();
    if (prior) {
      if (prior.actorId !== actorId || prior.digest !== digest) throw new ApiError(409, "operation-conflict");
      return prior.revision;
    }
    if (!intent?.linked) throw new ApiError(409, "receipt-not-linked");
    const payment = (await tx.get(db.doc(`paymentRequests/${intent.paymentRequestId}`))).data();
    if (!payment || payment.status !== "pending") throw new ApiError(409, "payment-not-pending");
    if (body.expectedRevision !== (previous?.reviewRevision ?? 0)) throw new ApiError(409, "receipt-review-changed");
    const next = (previous?.reviewRevision ?? 0) + 1, now = Date.now();
    tx.set(ref, { ...previous, personId: intent.personId, chargeId: intent.chargeId, paymentRequestId: intent.paymentRequestId,
      confirmedReference: reference, confirmedAmountMinor: body.amountMinor, correctedBy: actorId, correctedAt: now, reviewRevision: next });
    tx.set(db.doc(`receiptCorrectionOutbox/${id}`), { id, reference, amountMinor: body.amountMinor, actorId, at: now, revision: next });
    tx.set(receipt, { actorId, digest, revision: next });
    appendAudit(tx, db, { actorId, action: "receipt-corrected", entityType: "receipt", entityId: id, personId: intent.personId, operationId: operation,
      before: previous ? { normalizedReference: previous.confirmedReference ?? null, amountMinor: previous.confirmedAmountMinor ?? null } : null,
      after: { normalizedReference: reference, amountMinor: body.amountMinor }, reason });
    return next;
  });
  // Durable outbox recovery preserves the authoritative review if Supabase is unavailable.
  try { await syncReceiptCorrection(id); } catch { /* Worker retries the saved correction. */ }
  return { reviewRevision: revision };
}
export async function syncReceiptCorrection(id: string) {
  const db = adminDb(), ref = db.doc(`receiptCorrectionOutbox/${id}`), command = (await ref.get()).data();
  if (!command) return;
  const result = await supabaseAdmin().from(RECEIPT_TABLE).update({ corrected_reference: command.reference, corrected_amount_minor: command.amountMinor,
    corrected_by: command.actorId, corrected_at: new Date(command.at).toISOString(), correction_revision: command.revision })
    .eq("id", id).lt("correction_revision", command.revision);
  if (result.error) throw new ApiError(503, "receipt-correction-sync-pending");
  await db.runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (current?.revision === command.revision) tx.delete(ref); });
}
export async function recoverReceiptCorrections() {
  const rows = await adminDb().collection("receiptCorrectionOutbox").limit(50).get();
  for (const row of rows.docs) { try { await syncReceiptCorrection(row.id); } catch { /* Keep the durable command. */ } }
}
