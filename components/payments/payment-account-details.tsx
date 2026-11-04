import Image from "next/image";
import type { PaymentAccount } from "@/lib/finance/payment-methods";
import styles from "./payment-account-details.module.css";

export function PaymentAccountDetails({ account }: { account?: PaymentAccount }) {
  if (!account) return null;
  if (account.kind === "gcash") return <section className={styles.gcash} aria-label="GCash payment details">
    <header className={styles.brandHeader}><Image unoptimized src="/images/payments/gcash-wordmark.png" width={730} height={180} alt="GCash" className={styles.wordmark} /><span>Scan to pay</span></header>
    <div className={styles.paymentBody}>
      <figure className={styles.paymentQr}>
        {account.qrImage ? <><Image unoptimized src={account.qrImage} width={320} height={320} alt="GCash payment QR code" className={styles.qrImage} /><figcaption>Scan using GCash or another compatible app.</figcaption></> : <div className={styles.missingQr}><p>No payment QR available.</p><span>Use the mobile number below to pay with GCash.</span></div>}
      </figure>
      <div className={styles.receivingDetails}>
        <dl><div><dt>Account holder</dt><dd>{account.accountHolder}</dd></div><div><dt>Mobile / account number</dt><dd className={styles.accountNumber}>{account.accountNumber}</dd></div></dl>
        <p className={styles.instructions}>Check the recipient and amount before paying, then upload your payment receipt.</p>
        {account.qrImage && <a className={styles.download} href={account.qrImage} download="GCash-payment-qr.png"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>Save QR image</a>}
      </div>
    </div>
  </section>;
  return <section className={styles.details} aria-label={`${account.name} payment details`}>
    <div><h3>{account.name}</h3><dl><div><dt>Account holder</dt><dd>{account.accountHolder}</dd></div><div><dt>{account.kind === "bank" ? "Account number" : "Mobile / account number"}</dt><dd>{account.accountNumber}</dd></div></dl>
    <p>{account.qrImage ? "Scan this QR or use the account details, then upload your payment receipt." : "Transfer to this account, then upload your payment receipt."}</p></div>
    {account.qrImage && <figure><Image unoptimized src={account.qrImage} width={240} height={240} alt={`${account.name} payment QR code`} /><a href={account.qrImage} download={`${account.name}-payment-qr.png`}>Save QR image</a></figure>}
  </section>;
}
