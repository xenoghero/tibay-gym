export type PaymentMethod = "cash" | "gcash" | `account_${string}`;
export interface PaymentAccount {
  id: `account_${string}`;
  kind: "gcash" | "maya" | "bank";
  name: string;
  accountHolder: string;
  accountNumber: string;
  qrImage: string | null;
  enabled: boolean;
}
export type PaymentAccountSnapshot = Omit<PaymentAccount, "qrImage" | "enabled">;
export interface PaymentSettings { revision: number; accounts: PaymentAccount[] }
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "cash" || value === "gcash" || (typeof value === "string" && /^account_[a-zA-Z0-9_-]{8,64}$/.test(value));
}
export function paymentLabel(payment: { method?: string | null; paymentAccountSnapshot?: PaymentAccountSnapshot | null }) {
  return payment.paymentAccountSnapshot?.name ?? (payment.method === "cash" ? "Cash" : payment.method === "gcash" ? "GCash" : "Electronic payment");
}
export function accountSnapshot(account: PaymentAccount): PaymentAccountSnapshot {
  const { id, kind, name, accountHolder, accountNumber } = account;
  return { id, kind, name, accountHolder, accountNumber };
}
