import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { normalizeGcashReference } from "@/lib/finance/references";
import { ApiError } from "./rfid/http";
export async function prepareReferenceClaim(tx: Transaction, db: Firestore, reference: unknown, paymentRequestId: string, chargeId: string) {
  let normalizedReference: string;
  try { normalizedReference = normalizeGcashReference(reference); } catch { throw new ApiError(400, "invalid-reference"); }
  const ref = db.doc(`approvedGcashReferences/${normalizedReference}`), previous = (await tx.get(ref)).data();
  if (previous && (previous.paymentRequestId !== paymentRequestId || previous.chargeId !== chargeId)) throw new ApiError(409, "reference-already-used");
  return { normalizedReference, commit: () => {
    if (!previous) tx.set(ref, { normalizedReference, paymentRequestId, chargeId, claimedAt: Date.now() });
  } };
}
