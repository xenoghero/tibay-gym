"use client";

import Image from "next/image";
import { StyledSelect, type SelectOption } from "@/components/ui/styled-select";
import { availablePaymentAccounts, type PaymentAccount, type PaymentMethod } from "@/lib/finance/payment-methods";

export function PaymentMethodSelect({ value, accounts, available, disabled, placement = "auto", onChange }: {
  value: PaymentMethod; accounts?: PaymentAccount[]; available?: boolean; disabled?: boolean; placement?: "auto" | "top";
  onChange(value: PaymentMethod): void;
}) {
  const gcashMark = <Image unoptimized src="/images/payments/gcash-symbol.png" width={28} height={28} alt="" />;
  const options: SelectOption[] = [
    { value: "cash", name: "Cash", detail: "Pay at the gym", mark: "₱", disabled: false, tone: "green" },
    ...(accounts ? availablePaymentAccounts(accounts).map(account => ({ value: account.id, name: account.name,
      detail: !available ? "Receipt upload unavailable" : account.kind === "bank" ? "Bank transfer" : "Mobile wallet",
      mark: gcashMark, disabled: !available, tone: "blue" as const })) : [
      { value: "gcash", name: "GCash", detail: available ? "Mobile wallet" : "Currently unavailable", mark: gcashMark, disabled: !available, tone: "blue" as const },
    ]),
  ];
  return <StyledSelect label="Payment method" value={value} options={options} disabled={disabled} placement={placement} onChange={value => onChange(value as PaymentMethod)} />;
}
