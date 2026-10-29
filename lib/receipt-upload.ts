import type { QrRequest } from "./attendance-api";
import { AttendanceApiError } from "./attendance-error";
export interface ReceiptPreparation { key: string; upload(request: QrRequest): Promise<{ receiptId: string; receiptToken: string }> }
export function dailyReceiptUpload(file: File, phone: string, key: string): ReceiptPreparation {
  return { key, upload: async request => {
    if (file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AttendanceApiError("Choose a JPG, PNG or WebP receipt up to 5 MB.", "invalid-image", 400);
    try {
      if (!request.guest) {
        const session = await fetch("/api/customer/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
        if (!session.ok) throw new AttendanceApiError("Could not open a restricted receipt-upload session. Check the number or try later.", "upload-session-failed", session.status);
      }
      const response = await fetch("/api/receipts/upload", { method: "POST", headers: { "Content-Type": file.type,
        "x-operation-id": request.eventId, "x-expected-amount": String(request.expectedAmountMinor),
        ...(request.voucherCode ? { "x-voucher-code": request.voucherCode } : {}),
        ...(request.guest ? { "x-registration": encodeURIComponent(JSON.stringify(request.guest)) } : {}) }, body: file, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === "receipt-operation-conflict") throw new AttendanceApiError("This upload attempt changed or crossed a date boundary. Retry to prepare a fresh upload.", "receipt-expired", 409);
        throw new AttendanceApiError("Receipt upload did not complete. No attendance was submitted; keep the same receipt and retry, or choose cash.", "receipt-upload-failed", response.status);
      }
      const proof = await response.json();
      if (!/^[a-f0-9]{64}$/.test(proof.receiptId) || !/^[A-Za-z0-9_-]{43}$/.test(proof.receiptToken)) throw new Error("Invalid upload response");
      return proof;
    } catch (error) {
      if (error instanceof AttendanceApiError) throw error;
      throw new AttendanceApiError("Could not confirm the receipt upload. No attendance was submitted. Retry the same receipt to recover it.", "receipt-upload-unconfirmed", 0);
    }
  } };
}
