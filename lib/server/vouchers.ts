import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Charge, ChargeKind, RateCategory } from "@/lib/finance/contracts";
import { discountQuote, normalizeVoucherCode, validateVoucher, type Voucher, type VoucherUse } from "@/lib/finance/vouchers";
import { operationId } from "@/lib/finance/rules";
import { adminDb } from "./firebase-admin";
import { ApiError } from "./rfid/http";
import { documentId } from "./rfid/validation";
import { appendAudit } from "./audit";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const usageId = (voucherId: string, personId: string) => hash([voucherId, personId]);
function translate(error: unknown): never { throw new ApiError(409, error instanceof Error ? error.message : "voucher-unavailable"); }

/** Read-only preparation. Call commit only after all transaction reads. */
export async function prepareVoucher(tx: Transaction, db: Firestore, input: {
  code?: unknown; personId: string; kind: ChargeKind; category: RateCategory; baseAmountMinor: number; at: number; actorId?: string;
}) {
  if (!input.code) return { ...discountQuote(null, input.baseAmountMinor, input.kind, input.category, input.at), commit: (_chargeId: string, _number: string) => {} };
  let code: string;
  try { code = normalizeVoucherCode(input.code); } catch (e) { translate(e); }
  const claim = (await tx.get(db.doc(`voucherCodeClaims/${code!}`))).data();
  if (!claim || claim.retiredAt) throw new ApiError(409, "voucher-unavailable");
  const v = (await tx.get(db.doc(`vouchers/${claim.voucherId}`))).data() as Voucher | undefined;
  if (!v || v.code !== code!) throw new ApiError(409, "voucher-unavailable");
  const customerRef = db.doc(`voucherCustomerUsage/${usageId(v.id, input.personId)}`), customer = (await tx.get(customerRef)).data();
  let quote;
  try { quote = discountQuote(v, input.baseAmountMinor, input.kind, input.category, input.at, (customer?.heldCount ?? 0) + (customer?.confirmedCount ?? 0)); }
  catch (e) { translate(e); }
  return { ...quote!, commit: (chargeId: string, transactionNumber: string) => {
    const id = hash([v.id, chargeId]);
    const use: VoucherUse = { ...quote!, id, voucherId: v.id, chargeId, personId: input.personId, kind: input.kind, category: input.category,
      status: "held", reservedAt: input.at, confirmedAt: null, releasedAt: null, transactionNumber };
    tx.set(db.doc(`voucherUses/${id}`), use);
    tx.update(db.doc(`vouchers/${v.id}`), { heldCount: v.heldCount + 1, everUsed: true });
    tx.set(customerRef, { voucherId: v.id, personId: input.personId, heldCount: (customer?.heldCount ?? 0) + 1, confirmedCount: customer?.confirmedCount ?? 0 });
    appendAudit(tx, db, { actorId: input.actorId ?? `customer:${input.personId}`, action: "voucher-reserved", entityType: "voucherUse", entityId: id,
      personId: input.personId, operationId: chargeId, after: { code: v.code, revision: v.revision, amountMinor: quote!.amountMinor, discountAmountMinor: quote!.discountAmountMinor, status: "held" } });
  } };
}

export async function previewVoucher(input: Parameters<typeof prepareVoucher>[2]) {
  const db = adminDb();
  return db.runTransaction(async tx => {
    const { commit: _commit, ...quote } = await prepareVoucher(tx, db, input);
    return quote;
  });
}

export async function prepareVoucherSettlement(tx: Transaction, db: Firestore, charge: Charge, action: "confirmed" | "released", actorId: string, at: number) {
  if (!charge.voucherSnapshot) return () => {};
  const voucherId = charge.voucherSnapshot.id, id = hash([voucherId, charge.id]);
  const useRef = db.doc(`voucherUses/${id}`), use = (await tx.get(useRef)).data() as VoucherUse | undefined;
  if (!use || use.status !== "held") throw new ApiError(409, "voucher-use-conflict");
  const vRef = db.doc(`vouchers/${voucherId}`), v = (await tx.get(vRef)).data() as Voucher;
  const customerRef = db.doc(`voucherCustomerUsage/${usageId(voucherId, charge.personId)}`), customer = (await tx.get(customerRef)).data();
  if (!v || !customer || v.heldCount < 1 || customer.heldCount < 1) throw new ApiError(409, "voucher-use-conflict");
  return () => {
    tx.update(useRef, { status: action, ...(action === "confirmed" ? { confirmedAt: at } : { releasedAt: at }) });
    tx.update(vRef, { heldCount: v.heldCount - 1, confirmedCount: v.confirmedCount + (action === "confirmed" ? 1 : 0),
      confirmedDiscountMinor: v.confirmedDiscountMinor + (action === "confirmed" ? use.discountAmountMinor : 0) });
    tx.update(customerRef, { heldCount: customer.heldCount - 1, confirmedCount: customer.confirmedCount + (action === "confirmed" ? 1 : 0) });
    appendAudit(tx, db, { actorId, action: `voucher-${action}`, entityType: "voucherUse", entityId: id, personId: charge.personId,
      operationId: `${charge.id}-${action}`, before: { status: "held" }, after: { status: action, discountAmountMinor: use.discountAmountMinor } });
  };
}

export async function saveVoucher(actorId: string, body: Record<string, unknown>) {
  let operation: string;
  try { operation = operationId(body.operationId); } catch { throw new ApiError(400, "invalid-operation-id"); }
  const db = adminDb(), id = body.id ? documentId(body.id) : randomUUID();
  const digest = hash([actorId, body]);
  return db.runTransaction(async tx => {
    const opRef = db.doc(`voucherOperations/${operation}`), op = (await tx.get(opRef)).data();
    if (op) { if (op.digest !== digest) throw new ApiError(409, "operation-conflict"); return op.result as Voucher; }
    const ref = db.doc(`vouchers/${id}`), current = (await tx.get(ref)).data() as Voucher | undefined;
    if (body.id && !current) throw new ApiError(404, "voucher-unavailable");
    if (current && body.revision !== current.revision) throw new ApiError(409, "voucher-revision");
    const action = body.action ?? "save", now = Date.now();
    let result: Voucher;
    if (action === "save") {
      let config;
      try { config = validateVoucher(body); } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : "voucher-invalid-settings"); }
      if (current?.status === "archived" || current?.status === "deleted") throw new ApiError(409, "voucher-unavailable");
      if (current?.everUsed && current.code !== config.code) throw new ApiError(409, "voucher-code-immutable");
      const claimRef = db.doc(`voucherCodeClaims/${config.code}`), claim = (await tx.get(claimRef)).data();
      if (claim && (claim.voucherId !== id || claim.retiredAt)) throw new ApiError(409, "voucher-code-taken");
      if (current && config.totalLimit !== null && config.totalLimit < current.heldCount + current.confirmedCount) throw new ApiError(409, "voucher-limit-below-usage");
      result = { ...config, id, status: current?.status ?? "enabled", revision: (current?.revision ?? 0) + 1,
        heldCount: current?.heldCount ?? 0, confirmedCount: current?.confirmedCount ?? 0, confirmedDiscountMinor: current?.confirmedDiscountMinor ?? 0,
        everUsed: current?.everUsed ?? false, createdAt: current?.createdAt ?? now, updatedAt: now, updatedBy: actorId };
      tx.set(claimRef, { voucherId: id });
      if (current && current.code !== config.code) tx.set(db.doc(`voucherCodeClaims/${current.code}`), { voucherId: id, retiredAt: now });
    } else {
      if (!current || current.status === "deleted" || current.status === "archived" || !["pause", "resume", "archive", "delete"].includes(String(action))) throw new ApiError(409, "voucher-unavailable");
      if (action === "delete" && current.everUsed) throw new ApiError(409, "voucher-used");
      result = { ...current, status: action === "pause" ? "paused" : action === "resume" ? "enabled" : action === "archive" ? "archived" : "deleted",
        revision: current.revision + 1, updatedAt: now, updatedBy: actorId };
      // Delete the unused campaign content; retain only the retired code and audit identity.
      if (action === "delete") { result.name = "Deleted voucher"; result.note = ""; }
    }
    if (action === "delete") tx.delete(ref); else tx.set(ref, result);
    tx.set(opRef, { digest, result });
    const audit = (v: Voucher) => ({ code: v.code, label: v.name, revision: v.revision, status: v.status, discountKind: v.discountKind, value: v.value,
      maxDiscountMinor: v.maxDiscountMinor, minimumBaseMinor: v.minimumBaseMinor, startsAt: v.startsAt, endsAt: v.endsAt,
      totalLimit: v.totalLimit, customerLimit: v.customerLimit, kinds: v.kinds.join(","), categories: v.categories.join(",") });
    appendAudit(tx, db, { actorId, action: current ? `voucher-${action}` : "voucher-created", entityType: "voucher", entityId: id,
      personId: null, operationId: operation, before: current ? audit(current) : null, after: audit(result) });
    return result;
  });
}

export async function listVouchers(params: URLSearchParams) {
  const db = adminDb();
  if (params.get("id")) {
    const id = documentId(params.get("id")), voucher = (await db.doc(`vouchers/${id}`).get()).data();
    if (!voucher) throw new ApiError(404, "voucher-unavailable");
    let query = db.collection("voucherUses").where("voucherId", "==", id).orderBy("__name__");
    if (params.get("cursor")) query = query.startAfter(documentId(params.get("cursor")));
    const rows = await query.limit(51).get();
    const uses = await Promise.all(rows.docs.slice(0, 50).map(async d => {
      const use = d.data() as VoucherUse;
      const [person, charge] = await Promise.all([
        db.doc(`persons/${use.personId}`).get(), db.doc(`charges/${use.chargeId}`).get(),
      ]);
      const pending = person.exists ? null : await db.doc(`unverifiedPersons/${use.personId}`).get();
      const paymentRequestId = charge.data()?.activePaymentRequestId ?? null;
      const payment = paymentRequestId ? (await db.doc(`paymentRequests/${paymentRequestId}`).get()).data() : null;
      return { ...use, customerName: person.data()?.name ?? pending?.data()?.name ?? "Deleted customer", paymentRequestId, paymentStatus: payment?.status ?? null };
    }));
    return { voucher, uses, nextCursor: rows.size > 50 ? rows.docs[49].id : null };
  }
  // Bound each page; search/filter scope is explicitly labeled in the admin UI.
  let query = db.collection("vouchers").orderBy("__name__");
  if (params.get("cursor")) query = query.startAfter(documentId(params.get("cursor")));
  const rows = await query.limit(51).get();
  return { records: rows.docs.slice(0, 50).map(d => d.data()), nextCursor: rows.size > 50 ? rows.docs[49].id : null };
}
