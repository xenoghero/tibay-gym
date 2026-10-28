import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "./firebase-admin";
import { appendAudit } from "./audit";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { operationId, philippineDate } from "@/lib/finance/rules";
import { accountingDeletionDate, DEFAULT_RECEIPT_RETENTION, type ReceiptRetention } from "@/lib/receipt-retention";

export async function readReceiptRetention(id: string) {
  const db = adminDb(), intent = (await db.doc(`receiptIntents/${id}`).get()).data();
  if (!intent?.linked) throw new ApiError(404, "receipt-not-linked");
  const payment = (await db.doc(`paymentRequests/${intent.paymentRequestId}`).get()).data();
  const policy = (await db.doc(`receiptRetention/${id}`).get()).data();
  return { policy: { ...DEFAULT_RECEIPT_RETENTION, ...policy } as ReceiptRetention, paymentStatus: payment?.status ?? "unavailable" };
}
export async function saveReceiptRetention(actorId: string, body: Record<string, unknown>) {
  const id = documentId(body.receiptId);
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  if (typeof body.disputeHold !== "boolean" || typeof body.legalHold !== "boolean" || !Number.isSafeInteger(body.expectedRevision)) throw new ApiError(400, "invalid-retention-policy");
  let accountingDeleteAfter: number | null = null;
  if (body.filingDeadline !== null || body.filedAt !== null) {
    try { accountingDeleteAfter = accountingDeletionDate(body.filingDeadline, body.filedAt); } catch { throw new ApiError(400, "invalid-filing-date"); }
  }
  const db = adminDb(), ref = db.doc(`receiptRetention/${id}`), operationRef = db.doc(`receiptRetentionOperations/${operation}`);
  const digest = createHash("sha256").update(JSON.stringify([actorId, id, body.disputeHold, body.legalHold, body.filingDeadline, body.filedAt, body.expectedRevision])).digest("hex");
  return db.runTransaction(async tx => {
    const prior = (await tx.get(operationRef)).data(), intent = (await tx.get(db.doc(`receiptIntents/${id}`))).data();
    const previous = (await tx.get(ref)).data();
    if (prior) { if (prior.digest !== digest) throw new ApiError(409, "operation-conflict"); return { revision: prior.revision }; }
    if (!intent?.linked) throw new ApiError(404, "receipt-not-linked");
    const payment = (await tx.get(db.doc(`paymentRequests/${intent.paymentRequestId}`))).data();
    if (previous?.purgeState) throw new ApiError(409, "receipt-removal-started");
    if ((previous?.revision ?? 0) !== body.expectedRevision) throw new ApiError(409, "retention-policy-changed");
    if (accountingDeleteAfter !== null && (payment?.status !== "approved" || typeof payment.reviewedAt !== "number"
      || String(body.filingDeadline) < philippineDate(payment.reviewedAt) || String(body.filedAt) < philippineDate(payment.reviewedAt)
      || String(body.filedAt) > philippineDate(Date.now()))) throw new ApiError(400, "invalid-accounting-period");
    const revision = (previous?.revision ?? 0) + 1;
    const next = { revision, disputeHold: body.disputeHold, legalHold: body.legalHold,
      filingDeadline: body.filingDeadline, filedAt: body.filedAt, accountingDeleteAfter };
    tx.set(ref, next); tx.set(operationRef, { digest, revision });
    appendAudit(tx, db, { actorId, action: "receipt-retention-updated", entityType: "receipt", entityId: id, personId: intent.personId,
      operationId: operation, before: previous ?? { ...DEFAULT_RECEIPT_RETENTION }, after: next, reason: "Receipt evidence holds/accounting retention updated" });
    return { revision };
  });
}
