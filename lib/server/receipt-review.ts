import "server-only";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { RECEIPT_TABLE } from "./receipt-store";
import { ApiError } from "./rfid/http";
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
