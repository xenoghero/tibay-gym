"use client";

import { StyledSelect, type SelectOption } from "@/components/ui/styled-select";
import type { PaymentAccount, PaymentMethod } from "@/lib/finance/payment-methods";

export function PaymentMethodSelect({ value, accounts, available, disabled, onChange }: {
  value: PaymentMethod; accounts?: PaymentAccount[]; available?: boolean; disabled?: boolean;
  onChange(value: PaymentMethod): void;
}) {
  const options: SelectOption[] = [
    { value: "cash", name: "Cash", detail: "Pay at the gym", mark: "₱", disabled: false },
    ...(accounts ? accounts.map(account => ({ value: account.id, name: account.name,
      detail: !available ? "Receipt upload unavailable" : account.kind === "bank" ? "Bank transfer" : "Mobile wallet",
      mark: account.kind === "bank" ? "↗" : "▣", disabled: !available })) : [
      { value: "gcash", name: "GCash", detail: available ? "Mobile wallet" : "Currently unavailable", mark: "▣", disabled: !available },
    ]),
  ];
  return <StyledSelect label="Payment method" value={value} options={options} disabled={disabled} onChange={value => onChange(value as PaymentMethod)} />;
}
