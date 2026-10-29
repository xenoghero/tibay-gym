import Image from "next/image";
import type { PaymentAccount } from "@/lib/finance/payment-methods";
import styles from "./payment-account-details.module.css";

export function PaymentAccountDetails({ account }: { account?: PaymentAccount }) {
  if (!account) return null;
  return <section className={styles.details} aria-label={`${account.name} payment details`}>
    <div><h3>{account.name}</h3><dl><div><dt>Account holder</dt><dd>{account.accountHolder}</dd></div><div><dt>{account.kind === "bank" ? "Account number" : "Mobile / account number"}</dt><dd>{account.accountNumber}</dd></div></dl>
    <p>{account.qrImage ? "Scan this QR or use the account details, then upload your payment receipt." : "Transfer to this account, then upload your payment receipt."}</p></div>
    {account.qrImage && <figure><Image unoptimized src={account.qrImage} width={240} height={240} alt={`${account.name} payment QR code`} /><a href={account.qrImage} download={`${account.name}-payment-qr.png`}>Save QR image</a></figure>}
  </section>;
}
