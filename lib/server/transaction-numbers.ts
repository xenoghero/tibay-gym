import "server-only";
import type { Firestore, Transaction } from "firebase-admin/firestore";
/** A transactionally allocated sequence, unrelated to collection/document counts. */
export async function prepareTransactionNumber(tx: Transaction, db: Firestore) {
  const ref = db.doc("_serverConfig/financialSequence"), current = (await tx.get(ref)).data()?.value ?? 0;
  if (!Number.isSafeInteger(current) || current < 0 || current >= 999999999999) throw new Error("Transaction sequence unavailable");
  const value = current + 1;
  return { number: `TB-${String(value).padStart(12, "0")}`, commit: () => tx.set(ref, { value }) };
}
