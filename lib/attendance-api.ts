import { AttendanceApiError } from "@/lib/attendance-error";
import { voucherMessages } from "@/lib/finance/vouchers";
export { AttendanceApiError } from "@/lib/attendance-error";

const attendanceMessages: Record<string, string> = {
  ...voucherMessages,
  "category-required": "Ask the administrator to set your Student / Regular category before a paid daily visit.",
  "daily-price-changed": "The daily rate changed. Look up your phone again and review the refreshed amount.",
  "daily-payment-required": "Choose a payment method for this daily session, then try again.",
  "gcash-unavailable": "GCash receipt submission is not available yet. Choose cash or ask the administrator.",
  "registration-fields-required": "Complete your category and registration source.",
  "valid-receipt-required": "A valid private receipt is required. Upload it again before submitting GCash.",
  "daily-payment-already-submitted": "A daily payment is already submitted. Ask the administrator to review it.",
  "registration-reuse": "This registration attempt has ended. Look up your phone number again to start a new registration.",
  "no-open-session": "There is no open visit to check out of.",
  "checkout-session-changed": "Your open visit changed. Refresh its details before checking out.",
  "guest-conflict": "An account already exists for this phone number. Choose Check In to record your visit.",
  "retry-expired": "Attendance is still unconfirmed and the recovery window has ended. Do not start another scan; it could reverse an earlier attendance action.",
  "attendance-not-initialized": "Attendance is temporarily unavailable. Please try again later.",
  "rate-limited": "Too many attempts. Wait a moment before retrying.",
  "attendance-cooldown": "Attendance was just updated. Please wait before changing it again.",
  "unauthorized": "Refresh this page and sign in again to continue.",
  "admin-required": "Refresh this page and sign in again to continue.",
};

export async function attendanceApi<T>(path: string, body: unknown, admin = false): Promise<T> {
  // Public attendance does not load the browser Firebase SDK or start auth work.
  const token = admin ? await (await import("@/lib/firebase")).auth.currentUser?.getIdToken() : undefined;
  if (admin && !token) throw new Error("Sign in again to continue.");
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AttendanceApiError("Could not confirm attendance. Check your connection and retry the same request.", "network-unconfirmed", 0);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new AttendanceApiError("The response could not be confirmed. Retry the same request.", "invalid-response", response.status); }
  if (!response.ok) {
    const code = typeof data?.error === "string" && Object.hasOwn(attendanceMessages, data.error) ? data.error : "request-unconfirmed";
    const rawWait = Number(response.headers.get("Retry-After") ?? data?.retryAfterSeconds);
    const retryAfterSeconds = response.status === 429 && Number.isFinite(rawWait) && rawWait > 0
      ? Math.min(86_400, Math.ceil(rawWait)) : response.status === 429 ? 60 : undefined;
    throw new AttendanceApiError(attendanceMessages[code] ?? "Could not confirm attendance. Retry the same request.", code, response.status, retryAfterSeconds);
  }
  return data as T;
}

export interface QrRequest { eventId: string; requestedAt: number; personId?: string; guest?: { phone: string; name: string; address: string } & Partial<import("./registration").RegistrationFields>; intent?: "attendance" | "checkout"; expectedLogId?: string; paymentMethod?: "cash" | "gcash"; expectedAmountMinor?: number; receiptId?: string; receiptToken?: string; voucherCode?: string; voucherRevision?: number; voucherRateRevision?: number }
export interface QrLookupPerson { id: string; name: string; type: "member" | "guest"; status: "active" | "expired" | null; membershipExpiryMs: number | null; visitCount: number; unverified?: boolean }
export interface DailyRates { studentDailyMinor: number; regularDailyMinor: number; gcashAvailable?: boolean }
export interface DailyPaymentDue { amountMinor: number | null; expiredMember: boolean; gcashAvailable: boolean }
export interface QrLookupResponse { person: QrLookupPerson | null; expectedLogId?: string | null; dailyRates?: DailyRates; paymentDue?: DailyPaymentDue }
export interface QrResponse { action: "checked-in" | "checked-out"; personId: string; checkInAtMs: number; visitCount: number; unverified?: boolean }
