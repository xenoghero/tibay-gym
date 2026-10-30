import type { Voucher } from "@/lib/finance/vouchers";
export const voucherFixture = (extra: Partial<Voucher> = {}): Voucher => ({
  id: "voucher-1", code: "TRAIN10", name: "Training offer", note: "Private note", status: "enabled", revision: 1,
  discountKind: "percent", value: 1000, maxDiscountMinor: null, minimumBaseMinor: 0,
  kinds: ["daily_session", "renewal", "new_membership"], categories: ["student", "regular"], startsAt: null, endsAt: null,
  totalLimit: 10, customerLimit: 1, heldCount: 0, confirmedCount: 0, confirmedDiscountMinor: 0, everUsed: false,
  createdAt: 1000, updatedAt: 1000, updatedBy: "admin", ...extra,
});
