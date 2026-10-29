"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { PaymentRequest } from "@/lib/finance/contracts";
import { ReceiptReview } from "./receipt-review";
import { PaymentStatus, paymentDate, peso, styles } from "./payment-ui";

export function DailyPaymentHistory({ chargeId, currentPaymentRequestId }: { chargeId: string; currentPaymentRequestId?: string }) {
  const { user } = useAuth();
  const [payments, setPayments] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (user) user.getIdToken()
      .then(token => fetch(`/api/finance/daily?chargeId=${encodeURIComponent(chargeId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }))
      .then(async response => {
        if (!response.ok) throw new Error("Could not load payment history.");
        const data = await response.json();
        if (active) setPayments(data.payments);
      })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load payment history."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [user, chargeId, retry]);
  return <section aria-label="Payment history">
    <h3>Payment history</h3>
    {loading ? <LoadingSkeleton label="Loading payment history…" /> : error ? <p role="alert">{error} <button onClick={() => { setError(""); setLoading(true); setRetry(value => value + 1); }}>Retry history</button></p> : payments.length ? payments.map(payment => <details key={payment.id}>
      <summary>{payment.method === "gcash" ? "GCash" : "Cash"} · {peso(payment.amountMinor)} · {paymentDate(payment.submittedAt)} <PaymentStatus status={payment.status} /></summary>
      <dl className={styles.details}>
        <div><dt>Submitted</dt><dd>{new Date(payment.submittedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</dd></div>
        <div><dt>Payment ID</dt><dd>{payment.id}</dd></div>
        {payment.previousRequestId && <div><dt>Replaces payment</dt><dd>{payment.previousRequestId}</dd></div>}
        {payment.reviewedAt && <div><dt>Reviewed</dt><dd>{paymentDate(payment.reviewedAt)}</dd></div>}
        {payment.gcashReferenceSnapshot && <div><dt>GCash reference</dt><dd>{payment.gcashReferenceSnapshot}</dd></div>}
      </dl>
      {payment.rejectionReason && <p>Rejection reason: {payment.rejectionReason}</p>}
      {payment.receiptId && payment.id !== currentPaymentRequestId && <ReceiptReview receiptId={payment.receiptId} expectedAmountMinor={payment.amountMinor} />}
    </details>) : <p>No payment submitted yet.</p>}
  </section>;
}
