import { isPaymentMethod } from "@/lib/finance/payment-methods";
import { createHash } from "node:crypto";
import { requireCustomer, sameOrigin } from "@/lib/server/customer-session";
import { uploadDailyReceipt } from "@/lib/server/receipt-store";
import { readPrivateImage } from "@/lib/server/private-images";
import { ApiError, handleApi, json } from "@/lib/server/rfid/http";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { registrationFields } from "@/lib/registration";
import { attendancePhone, attendanceText } from "@/lib/server/attendance-request";
import { eventId, documentId } from "@/lib/server/rfid/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    sameOrigin(request); publicRateLimiter.consume(publicCaller(request), "image");
    const paymentMethod = request.headers.get("x-payment-method") ?? "gcash";
    if (!isPaymentMethod(paymentMethod) || paymentMethod === "cash") throw new ApiError(400, "invalid-payment-method");
    const operation = eventId(request.headers.get("x-operation-id"));
    const expectedAmountMinor = Number(request.headers.get("x-expected-amount"));
    if (!Number.isSafeInteger(expectedAmountMinor) || expectedAmountMinor <= 0) throw new ApiError(400, "invalid-amount");
    let personId: string, category: unknown, registration = false;
    const rawKind = request.headers.get("x-charge-kind") ?? "daily_session";
    if (rawKind !== "daily_session" && rawKind !== "renewal" && rawKind !== "new_membership") throw new ApiError(400, "invalid-charge-kind");
    const previousRequestId = request.headers.get("x-previous-request-id") ?? undefined;
    if (previousRequestId) documentId(previousRequestId);
    const header = request.headers.get("x-registration");
    if (header) {
      if (rawKind !== "daily_session" || previousRequestId) throw new ApiError(400, "invalid-registration");
      if (header.length > 4096) throw new ApiError(413, "body-too-large");
      let data;
      try { data = JSON.parse(decodeURIComponent(header)); } catch { throw new ApiError(400, "invalid-registration"); }
      if (!data || typeof data !== "object") throw new ApiError(400, "invalid-registration");
      attendancePhone(data.phone); attendanceText(data.name, 120);
      try { category = registrationFields(data).rateCategory; } catch { throw new ApiError(400, "registration-fields-required"); }
      personId = `qr-${createHash("sha256").update(operation).digest("hex")}`; registration = true;
    } else {
      const customer = await requireCustomer(request); personId = customer.session.personId; category = customer.person.rateCategory;
    }
    return json(await uploadDailyReceipt({ paymentMethod, paymentRevision: Number(request.headers.get("x-payment-revision")), personId, category, operationId: operation, expectedAmountMinor, registration,
      kind: rawKind, previousRequestId, voucherCode: request.headers.get("x-voucher-code") ?? undefined, bytes: await readPrivateImage(request) }));
  });
}
