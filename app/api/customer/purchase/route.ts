import { customerPaymentOptions } from "@/lib/server/payment-methods";
import { requireCustomer } from "@/lib/server/customer-session";
import { getPurchaseQuote, submitPurchase } from "@/lib/server/purchases";
import { handleApi, json, readBody } from "@/lib/server/rfid/http";
import { reconcileReceiptLink, receiptsAvailable } from "@/lib/server/receipt-store";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleApi(async () => {
    // The purchase flow itself limits unverified profiles to coaching.
    const { session } = await requireCustomer(request);
    const params = new URL(request.url).searchParams;
    if (params.get("voucherCode")) publicRateLimiter.consume(publicCaller(request), "lookup");
    return json({ ...await getPurchaseQuote(session.personId, params.get("previousRequestId") ?? undefined, params.get("voucherCode") ?? undefined, params.has("months") ? Number(params.get("months")) : undefined, params.get("packageId") ?? undefined, params.has("topUpSessions") ? Number(params.get("topUpSessions")) : undefined), gcashAvailable: await receiptsAvailable(), ...await customerPaymentOptions() });
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const { session } = await requireCustomer(request);
    const body = await readBody(request, 4096), result = await submitPurchase(`customer:${session.personId}`, session.personId, body);
    if (typeof body.receiptId === "string") { try { await reconcileReceiptLink(body.receiptId); } catch { /* Durable intent recovery. */ } }
    return json(result);
  });
}
