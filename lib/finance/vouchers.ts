import type { ChargeKind, RateCategory } from "./contracts";

export interface Voucher {
  id: string; code: string; name: string; note: string;
  status: "enabled" | "paused" | "archived" | "deleted";
  revision: number; discountKind: "fixed" | "percent";
  value: number; maxDiscountMinor: number | null; minimumBaseMinor: number;
  kinds: ChargeKind[]; categories: RateCategory[];
  startsAt: number | null; endsAt: number | null;
  totalLimit: number | null; customerLimit: number | null;
  heldCount: number; confirmedCount: number; confirmedDiscountMinor: number;
  everUsed: boolean; createdAt: number; updatedAt: number; updatedBy: string;
}
export interface VoucherSnapshot {
  id: string; code: string; revision: number; discountKind: Voucher["discountKind"]; value: number;
  maxDiscountMinor: number | null;
}
export interface DiscountQuote {
  baseAmountMinor: number; discountAmountMinor: number; amountMinor: number;
  voucherSnapshot: VoucherSnapshot | null;
}
export interface VoucherUse extends DiscountQuote {
  id: string; voucherId: string; chargeId: string; personId: string; kind: ChargeKind;
  category: RateCategory; status: "held" | "confirmed" | "released";
  reservedAt: number; confirmedAt: number | null; releasedAt: number | null;
  transactionNumber: string;
  customerName?: string; paymentStatus?: string | null; paymentRequestId?: string | null;
}
export const voucherMessages: Record<string, string> = {
  "voucher-invalid": "Enter a valid voucher code.",
  "voucher-unavailable": "This code is unavailable. Check the code or try another.",
  "voucher-not-started": "This code is not available yet.",
  "voucher-expired": "This code has expired.",
  "voucher-scope": "This code does not apply to this purchase or rate category.",
  "voucher-minimum": "This purchase does not meet the code’s minimum amount.",
  "voucher-limit": "This code has reached its usage limit.",
  "voucher-customer-limit": "You have reached this code’s per-customer limit.",
  "voucher-payable": "This discount would leave less than PHP 1 to pay. Choose another code.",
  "voucher-no-discount": "This code does not reduce the price of this purchase.",
  "voucher-changed": "The voucher changed. Apply it again and review the new total.",
  "voucher-code-taken": "This code already exists or has been retired. Choose another code.",
  "voucher-revision": "This voucher changed in another session. Reload it before saving.",
  "voucher-used": "Used codes must be archived to preserve their history.",
  "voucher-invalid-settings": "Check the discount, eligibility, dates and usage limits.",
  "voucher-code-immutable": "Code text stays fixed. Duplicate this voucher to use a different code.",
  "voucher-limit-below-usage": "The total limit cannot be lower than held and confirmed uses.",
};
export function normalizeVoucherCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9-]{6,24}$/.test(value.trim().toUpperCase())) throw new Error("voucher-invalid");
  return value.trim().toUpperCase();
}
export function voucherAvailability(v: Voucher, at: number): string {
  if (v.status !== "enabled") return v.status;
  if (v.startsAt !== null && at < v.startsAt) return "scheduled";
  if (v.endsAt !== null && at >= v.endsAt) return "expired";
  if (v.totalLimit !== null && v.heldCount + v.confirmedCount >= v.totalLimit) return "limit reached";
  return "available";
}
export function discountQuote(v: Voucher | null, base: number, kind: ChargeKind, category: RateCategory, at: number, customerUses = 0): DiscountQuote {
  if (!v) return { baseAmountMinor: base, discountAmountMinor: 0, amountMinor: base, voucherSnapshot: null };
  const state = voucherAvailability(v, at);
  if (state !== "available") throw new Error(state === "scheduled" ? "voucher-not-started" : state === "expired" ? "voucher-expired" : state === "limit reached" ? "voucher-limit" : "voucher-unavailable");
  if (!v.kinds.includes(kind) || !v.categories.includes(category)) throw new Error("voucher-scope");
  if (base < v.minimumBaseMinor) throw new Error("voucher-minimum");
  if (v.customerLimit !== null && customerUses >= v.customerLimit) throw new Error("voucher-customer-limit");
  // Percentage uses basis points; round down once to a whole centavo.
  let discount = v.discountKind === "fixed" ? v.value : Math.floor(base * v.value / 10000);
  if (v.maxDiscountMinor !== null) discount = Math.min(discount, v.maxDiscountMinor);
  if (discount < 1) throw new Error("voucher-no-discount");
  if (base - discount < 100) throw new Error("voucher-payable");
  return { baseAmountMinor: base, discountAmountMinor: discount, amountMinor: base - discount,
    voucherSnapshot: { id: v.id, code: v.code, revision: v.revision, discountKind: v.discountKind, value: v.value, maxDiscountMinor: v.maxDiscountMinor } };
}
export function validateVoucher(body: Record<string, unknown>) {
  const fail = () => { throw new Error("voucher-invalid-settings"); };
  const integer = (n: unknown, max: number, min = 1): number => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max ? n : fail();
  const nullable = (n: unknown, max: number) => n === null ? null : integer(n, max);
  const code = normalizeVoucherCode(body.code);
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80 || typeof body.note !== "string" || body.note.length > 500) fail();
  if (body.discountKind !== "fixed" && body.discountKind !== "percent") fail();
  const discountKind = body.discountKind as Voucher["discountKind"];
  const value = integer(body.value, discountKind === "percent" ? 10000 : 100_000_000);
  const kinds = body.kinds, categories = body.categories;
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(k => !["daily_session", "renewal", "new_membership"].includes(k))) fail();
  if (!Array.isArray(categories) || !categories.length || categories.some(c => !["student", "regular"].includes(c))) fail();
  const startsAt = nullable(body.startsAt, 8_640_000_000_000_000), endsAt = nullable(body.endsAt, 8_640_000_000_000_000);
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) fail();
  return { code, name: (body.name as string).trim(), note: (body.note as string).trim(), discountKind, value,
    maxDiscountMinor: discountKind === "percent" ? nullable(body.maxDiscountMinor, 100_000_000) : null,
    minimumBaseMinor: integer(body.minimumBaseMinor, 100_000_000, 0),
    kinds: [...new Set(kinds as ChargeKind[])], categories: [...new Set(categories as RateCategory[])], startsAt, endsAt,
    totalLimit: nullable(body.totalLimit, 1_000_000), customerLimit: nullable(body.customerLimit, 1_000_000) };
}
