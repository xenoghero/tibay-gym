import { createHash } from "node:crypto";
import { scanAttendance } from "@/lib/server/attendance";
import { adminDb } from "@/lib/server/firebase-admin";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { documentId, eventId } from "@/lib/server/rfid/validation";
import { attendanceIntent, attendancePhone, attendanceText, onlyFields } from "@/lib/server/attendance-request";
import { registrationFields, type RegistrationFields } from "@/lib/registration";
import { reconcileReceiptLink } from "@/lib/server/receipt-store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    const caller = publicCaller(request);
    publicRateLimiter.consume(caller, "scan");
    const body = await readBody(request, 4096);
    onlyFields(body, ["eventId", "requestedAt", "personId", "guest", "intent", "expectedLogId", "paymentMethod", "expectedAmountMinor", "receiptId", "receiptToken", "voucherCode", "voucherRevision", "voucherRateRevision"]);
    if (body.voucherCode !== undefined && (typeof body.voucherCode !== "string" || body.voucherCode.length > 24 || !Number.isSafeInteger(body.voucherRevision) || !Number.isSafeInteger(body.voucherRateRevision))) throw new ApiError(400, "voucher-invalid");
    if (body.paymentMethod !== undefined && body.paymentMethod !== "cash" && body.paymentMethod !== "gcash") throw new ApiError(400, "invalid-payment-method");
    if (body.expectedAmountMinor !== undefined && (typeof body.expectedAmountMinor !== "number" || !Number.isSafeInteger(body.expectedAmountMinor) || body.expectedAmountMinor <= 0)) throw new ApiError(400, "invalid-amount");
    if ((body.receiptId !== undefined || body.receiptToken !== undefined) && body.paymentMethod !== "gcash") throw new ApiError(400, "invalid-receipt");
    if (body.receiptToken !== undefined && (typeof body.receiptToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.receiptToken))) throw new ApiError(400, "invalid-receipt");
    const id = eventId(body.eventId);
    if (typeof body.requestedAt !== "number" || !Number.isSafeInteger(body.requestedAt) || body.requestedAt < 0) throw new ApiError(400, "invalid-body");
    const intent = attendanceIntent(body.intent);
    const expectedLogId = intent === "checkout" ? documentId(body.expectedLogId) : undefined;
    if (intent !== "checkout" && body.expectedLogId !== undefined) throw new ApiError(400, "invalid-body");
    const guest = body.guest;
    let personId: string;
    let capture: ({ name: string; phone: string; address: string } & RegistrationFields) | undefined;
    if (guest !== undefined) {
      if (intent === "checkout" || body.personId !== undefined) throw new ApiError(400, "invalid-body");
      if (!guest || typeof guest !== "object" || Array.isArray(guest)) throw new ApiError(400, "invalid-body");
      const data = guest as Record<string, unknown>;
      if (Object.keys(data).some((key) => !["phone", "name", "address", "rateCategory", "leadSource", "leadSourceOther"].includes(key))) throw new ApiError(400, "invalid-body");
      let registration: RegistrationFields;
      try { registration = registrationFields(data); } catch { throw new ApiError(400, "registration-fields-required"); }
      capture = { phone: attendancePhone(data.phone), name: attendanceText(data.name, 120), address: attendanceText(data.address, 500, true), ...registration };
      personId = `qr-${createHash("sha256").update(id).digest("hex")}`;
    } else personId = documentId(body.personId);
    if (capture) publicRateLimiter.consume(caller, "guest", JSON.stringify([id, body.requestedAt, capture]));
    const result = await scanAttendance({ source: "qr", personId, guest: capture, eventId: id,
      ...(body.paymentMethod ? { paymentMethod: body.paymentMethod } : {}),
      ...(typeof body.expectedAmountMinor === "number" ? { expectedAmountMinor: body.expectedAmountMinor } : {}),
      ...(typeof body.voucherCode === "string" ? { voucherCode: body.voucherCode, voucherRevision: body.voucherRevision as number, voucherRateRevision: body.voucherRateRevision as number } : {}),
      ...(body.receiptId ? { receiptId: documentId(body.receiptId), receiptToken: body.receiptToken as string } : {}),
      requestedAt: body.requestedAt, ...(intent === "checkout" ? { intent, expectedLogId } : {}) });
    if (!result.action || !result.logId) throw new ApiError(409, result.resultCode);
    if (typeof body.receiptId === "string") {
      try { await reconcileReceiptLink(body.receiptId); } catch { console.info(JSON.stringify({ metric: "receipt-link-recovery-needed" })); }
    }
    // Approval can move records between the scan commit and this read. A read
    // transaction gives the response one consistent view of either namespace.
    const details = await adminDb().runTransaction(async tx => {
      const official = (await tx.get(adminDb().doc(`persons/${personId}`))).data();
      const unverified = !official;
      const person = official ?? (await tx.get(adminDb().doc(`unverifiedPersons/${personId}`))).data();
      const log = (await tx.get(adminDb().doc(`${unverified ? "unverifiedAttendanceLogs" : "attendanceLogs"}/${result.logId}`))).data();
      if (!log || !person || person.deletingAt) throw new ApiError(409, "person-unavailable");
      return { checkInAtMs: log.checkInAt.toMillis(), visitCount: person.visitCount,
        ...(unverified ? { unverified: true } : {}) };
    });
    return json({ action: result.action, personId, ...details });
  }, "qr-scan");
}
