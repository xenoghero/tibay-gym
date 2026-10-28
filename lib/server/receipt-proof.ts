import "server-only";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { documentId } from "./rfid/validation";
import { ApiError } from "./rfid/http";
export async function readyReceipt(tx: Transaction, db: Firestore, input: {
  receiptId?: string; receiptToken?: string; personId: string; chargeId: string; amountMinor: number; at: number;
}) {
  if (!input.receiptId || !input.receiptToken || !/^[A-Za-z0-9_-]{43}$/.test(input.receiptToken)) throw new ApiError(409, "valid-receipt-required");
  const ref = db.doc(`receiptIntents/${documentId(input.receiptId)}`), receipt = (await tx.get(ref)).data();
  const tokenHash = createHash("sha256").update(input.receiptToken).digest("hex");
  if (!receipt || receipt.state !== "ready" || receipt.tokenHash !== tokenHash || receipt.personId !== input.personId ||
      receipt.chargeId !== input.chargeId || receipt.amountMinor !== input.amountMinor || (!receipt.linked && receipt.expiresAt <= input.at)) throw new ApiError(409, "valid-receipt-required");
  return { ref, paymentRequestId: documentId(receipt.paymentRequestId), receiptId: input.receiptId,
    commit: () => tx.update(ref, { linked: true, reconciled: false, linkedAt: input.at }) };
}
