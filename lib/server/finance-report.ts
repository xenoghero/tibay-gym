import "server-only";
import { createHash } from "node:crypto";
import type { Query, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { buildFinanceReport, reportRange } from "@/lib/finance/report";
import type { Charge, PaymentRequest } from "@/lib/finance/contracts";

export const FINANCE_SOURCE_LIMIT = 5000;
async function readPages(tx: Transaction, base: Query) {
  const rows: QueryDocumentSnapshot[] = []; let query = base;
  while (true) {
    const page = await tx.get(query.limit(500)); rows.push(...page.docs);
    if (rows.length > FINANCE_SOURCE_LIMIT) throw new ApiError(413, "report-record-limit");
    if (page.size < 500) return rows;
    query = base.startAfter(page.docs.at(-1)!);
  }
}
export async function financeReport(params: URLSearchParams) {
  let range;
  try { range = reportRange(params); } catch { throw new ApiError(400, "invalid-report-range"); }
  const cursor = params.get("cursor"); let after: { at: number; id: string } | null = null;
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Number.isFinite(parsed.at) || typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.id)) throw new Error();
      after = parsed;
    } catch { throw new ApiError(400, "invalid-report-cursor"); }
  }
  const db = adminDb();
  return db.runTransaction(async tx => {
    const settings = (await tx.get(db.doc("gymSettings/finance"))).data();
    // A read-only Firestore transaction gives all query pages and joins one consistent view.
    const [charged, recognized, confirmed, pending] = await Promise.all([
      readPages(tx, db.collection("charges").where("chargeDate", ">=", range.from).where("chargeDate", "<=", range.through).orderBy("chargeDate").orderBy("__name__")),
      readPages(tx, db.collection("charges").where("recognizedPurchaseAt", ">=", range.startMs).where("recognizedPurchaseAt", "<=", range.endMs).orderBy("recognizedPurchaseAt").orderBy("__name__")),
      readPages(tx, db.collection("paymentRequests").where("confirmedAt", ">=", range.startMs).where("confirmedAt", "<=", range.endMs).orderBy("confirmedAt").orderBy("__name__")),
      readPages(tx, db.collection("paymentRequests").where("status", "==", "pending").orderBy("submittedAt").orderBy("__name__")),
    ]);
    const charges = new Map<string, Charge>(), requests = new Map<string, PaymentRequest>();
    for (const doc of [...charged, ...recognized]) charges.set(doc.id, { ...doc.data(), id: doc.id } as Charge);
    for (const doc of [...confirmed, ...pending]) requests.set(doc.id, { ...doc.data(), id: doc.id } as PaymentRequest);
    const missingCharges = [...new Set([...requests.values()].map(request => request.chargeId))].filter(id => !charges.has(id));
    for (let i = 0; i < missingCharges.length; i += 100) {
      const rows = await tx.getAll(...missingCharges.slice(i, i + 100).map(id => db.doc(`charges/${id}`)));
      for (const doc of rows) { if (!doc.exists) throw new ApiError(409, "financial-data-conflict"); charges.set(doc.id, { ...doc.data(), id: doc.id } as Charge); }
    }
    const missingRequests = [...new Set([...charges.values()].flatMap(charge => [charge.activePaymentRequestId, charge.confirmedPaymentRequestId].filter((id): id is string => !!id)))].filter(id => !requests.has(id));
    for (let i = 0; i < missingRequests.length; i += 100) {
      const rows = await tx.getAll(...missingRequests.slice(i, i + 100).map(id => db.doc(`paymentRequests/${id}`)));
      for (const doc of rows) { if (!doc.exists) throw new ApiError(409, "financial-data-conflict"); requests.set(doc.id, { ...doc.data(), id: doc.id } as PaymentRequest); }
    }
    let result;
    try { result = buildFinanceReport([...charges.values()], [...requests.values()], range); }
    catch { throw new ApiError(409, "financial-data-conflict"); }
    const filtered = after ? result.ledger.filter(row => row.activityAt < after!.at || row.activityAt === after!.at && row.id.localeCompare(after!.id) > 0) : result.ledger;
    const ledger = filtered.slice(0, 50), last = ledger.at(-1);
    return { ...result, ledger, nextCursor: filtered.length > 50 && last ? Buffer.from(JSON.stringify({ at: last.activityAt, id: last.id })).toString("base64url") : null,
      revision: createHash("sha256").update(JSON.stringify(result)).digest("hex"), generatedAt: Date.now(), financialCutoverAt: settings?.financialCutoverAt ?? null };
  }, { readOnly: true });
}
