import "server-only";
import { createHash } from "node:crypto";
import type { PaymentAccountSnapshot } from "@/lib/finance/payment-methods";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { normalizePaymentReference } from "@/lib/finance/references";
import { ApiError } from "./rfid/http";
export async function prepareReferenceClaim(tx: Transaction, db: Firestore, reference: unknown, paymentRequestId: string, chargeId: string, account?: PaymentAccountSnapshot | null) {
  let normalizedReference: string;
  try { normalizedReference = normalizePaymentReference(reference, account); } catch { throw new ApiError(400, "invalid-reference"); }
  const ref = db.doc(referenceClaimPath(normalizedReference, account)), previous = (await tx.get(ref)).data();
  if (previous && (previous.paymentRequestId !== paymentRequestId || previous.chargeId !== chargeId)) throw new ApiError(409, "reference-already-used");
  return { normalizedReference, commit: () => {
    if (!previous) tx.set(ref, { normalizedReference, paymentRequestId, chargeId, claimedAt: Date.now() });
  } };
}

export function referenceClaimPath(reference: string, account?: PaymentAccountSnapshot | null) {
  // GCash's globally unique references share the historical namespace.
  return !account || account.kind === "gcash" ? `approvedGcashReferences/${reference}`
    : `approvedPaymentReferences/${createHash("sha256").update(JSON.stringify([account.kind, account.accountNumber.replace(/\s/g, "").toUpperCase(), reference])).digest("hex")}`;
}
