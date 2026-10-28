import "server-only";
import { adminDb } from "./firebase-admin";
import { supabaseAdmin } from "./supabase";
import { RECEIPT_BUCKET, RECEIPT_TABLE } from "./receipt-store";
import { ApiError } from "./rfid/http";
import { DEFAULT_RECEIPT_RETENTION, receiptDeletionDue, type ReceiptRetention } from "@/lib/receipt-retention";
import { appendAudit } from "./audit";
/** Rotating bounded scan covers legacy intents and interrupted removals without new indexes. */
export async function cleanupReceiptRetention() {
  const db = adminDb(), cursorRef = db.doc("maintenanceCursors/receiptRetention");
  const cursor = (await cursorRef.get()).data()?.after;
  let query = db.collection("receiptIntents").orderBy("__name__").limit(25);
  if (typeof cursor === "string") query = query.startAfter(cursor);
  const rows = await query.get();
  let removed = 0;
  for (const row of rows.docs) {
    const ref = db.doc(`receiptRetention/${row.id}`);
    const claimed = await db.runTransaction(async tx => {
      const intent = (await tx.get(row.ref)).data(), stored = (await tx.get(ref)).data();
      const policy = { ...DEFAULT_RECEIPT_RETENTION, ...stored } as ReceiptRetention;
      if (!intent?.linked || policy.purgeState === "purged") return null;
      const payment = (await tx.get(db.doc(`paymentRequests/${intent.paymentRequestId}`))).data();
      // Pending/unknown payments and unconfirmed accounting periods stay protected after profile deletion too.
      if (policy.purgeState !== "purging" && !receiptDeletionDue(payment, policy, Date.now())) return null;
      if (policy.purgeState !== "purging") tx.set(ref, { ...policy, purgeState: "purging", revision: policy.revision + 1 });
      return intent;
    });
    if (!claimed) continue;
    const supabase = supabaseAdmin();
    const receipt = await supabase.from(RECEIPT_TABLE).select("id,private_object_path").eq("id", row.id).single();
    if (receipt.error) throw new ApiError(503, "receipt-retention-cleanup-pending");
    // Fence OCR before removing the object; a running worker cannot restore raw text after losing its claim.
    const fenced = await supabase.from(RECEIPT_TABLE).update({ raw_text: null, artifact_deleted_at: new Date().toISOString(),
      ocr_status: "needs_review", claim_token: null, lease_until: null }).eq("id", row.id);
    if (fenced.error) throw new ApiError(503, "receipt-retention-cleanup-pending");
    const deleted = await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.data.private_object_path]);
    if (deleted.error) throw new ApiError(503, "receipt-retention-cleanup-pending");
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.purgeState === "purged") return;
      tx.update(ref, { purgeState: "purged", purgedAt: Date.now() });
      appendAudit(tx, db, { actorId: "system:retention", action: "receipt-evidence-removed", entityType: "receipt", entityId: row.id,
        personId: claimed.personId, operationId: `retention-${row.id}`, after: { deleted: true }, reason: "Evidence retention period elapsed; minimal financial records retained" });
    });
    removed++;
  }
  await cursorRef.set({ after: rows.size === 25 ? rows.docs.at(-1)!.id : null });
  return removed;
}
