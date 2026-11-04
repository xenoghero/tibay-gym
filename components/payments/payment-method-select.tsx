"use client";

import Image from "next/image";
import { StyledSelect, type SelectOption } from "@/components/ui/styled-select";
import { availablePaymentAccounts, type PaymentAccount, type PaymentMethod } from "@/lib/finance/payment-methods";

export function PaymentMethodSelect({ value, accounts, available, disabled, placement = "auto", onChange }: {
  value: PaymentMethod; accounts?: PaymentAccount[]; available?: boolean; disabled?: boolean; placement?: "auto" | "top";
  onChange(value: PaymentMethod): void;
}) {
  const gcashMark = <Image unoptimized src="/images/payments/gcash-symbol.png" width={28} height={28} alt="" />;
  const cashMark = <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 9v6m12-6v6" /></svg>;
  const options: SelectOption[] = [
    { value: "cash", name: "Cash", detail: "Pay at the gym", mark: cashMark, disabled: false, tone: "green" },
    ...(accounts ? availablePaymentAccounts(accounts).map(account => ({ value: account.id, name: account.name,
      detail: !available ? "Receipt upload unavailable" : account.kind === "bank" ? "Bank transfer" : "Mobile wallet",
      mark: gcashMark, disabled: !available, tone: "blue" as const })) : [
      { value: "gcash", name: "GCash", detail: available ? "Mobile wallet" : "Currently unavailable", mark: gcashMark, disabled: !available, tone: "blue" as const },
    ]),
  ];
  return <StyledSelect label="Payment method" value={value} options={options} disabled={disabled} placement={placement} onChange={value => onChange(value as PaymentMethod)} />;
}
