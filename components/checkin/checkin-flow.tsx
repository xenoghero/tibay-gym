"use client";

import { PaymentAccountDetails } from "@/components/payments/payment-account-details";
import type { PaymentAccount } from "@/lib/finance/payment-methods";

import type { PaymentMethod } from "@/lib/finance/payment-methods";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { EntryShell } from "./entry-shell";
import styles from "./entry.module.css";
import { ImageUpload } from "./image-upload";
import { Timestamp } from "firebase/firestore";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import { attendanceApi, type QrLookupResponse, type QrResponse } from "@/lib/attendance-api";
import { CheckinAttempt, RECOVERY_MS } from "@/lib/checkin-attempt";
import { formatLongDate } from "@/lib/dates";
import { registrationFields } from "@/lib/registration";
import { RegistrationInputs } from "./registration-fields";
import { OptionalPhoto } from "./optional-photo";
import { RECEIPT_RETENTION_NOTICE } from "@/lib/receipt-retention";
import { dailyReceiptUpload } from "@/lib/receipt-upload";
import { AttendanceApiError } from "@/lib/attendance-error";
import { CHECKIN_PHONE_ERROR, isCheckinPhone } from "@/lib/checkin-phone";
import { VoucherEntry, PriceBreakdown, voucherError } from "@/components/people/voucher-entry";
import type { DiscountQuote } from "@/lib/finance/vouchers";

// Attendance requests go through the backend, with no page-load cleanup.
const C = {
  ink: "#0d0d0d", paper: "#ffffff", panel: "#faf8f0", muted: "#6f6f6d",
  line: "#e7e2d2", accent: "#ffcc00", accentText: "#806000", onAccent: "#171400",
  accentSoft: "rgba(255, 204, 0, 0.14)", green: "#1c6b3c", greenSoft: "rgba(28, 107, 60, 0.10)",
} as const;
const displayFont = "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const bodyFont = "var(--font-geist-sans), system-ui, sans-serif";
interface Receipt {
  paymentMethod?: PaymentMethod;
  paymentName?: string;
  paymentAmount?: number | null;
  unverified?: boolean;
  name: string;
  type: "member" | "guest";
  status: "active" | "expired" | null;
  membershipExpiry: Timestamp | null;
  visitCount: number;
}
const ACCIDENTAL_RESCAN_MS = 15 * 1000;

export function CheckInFlow({ registrationIntent = false, onBack }: { registrationIntent?: boolean; onBack?: () => void }) {
  const [attempt] = useState(() => new CheckinAttempt({
    lookup: body => attendanceApi<QrLookupResponse>("/api/attendance/lookup", body),
    scan: body => attendanceApi<QrResponse>("/api/attendance/scan", body),
    now: () => Date.now(), eventId: () => crypto.randomUUID(),
    online: () => typeof navigator === "undefined" || navigator.onLine,
  }));
  const state = useSyncExternalStore(attempt.subscribe, attempt.getSnapshot, attempt.getSnapshot);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState(""), [source, setSource] = useState(""), [other, setOther] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null), [receiptKey, setReceiptKey] = useState("");
  const [voucher, setVoucher] = useState<(DiscountQuote & { rateRevision: number }) | null>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registrationPending, setRegistrationPending] = useState(false);
  const [checkinRequested, setCheckinRequested] = useState(false);
  const registrationRequest = useRef<Record<string, unknown> | null>(null);
  const registrationInFlight = useRef(false);
  const [registrationRetryAt, setRegistrationRetryAt] = useState<number | null>(null);
  const locked = state.busy || !!state.pending || registrationBusy || registrationPending;
  const expired = state.status === "unconfirmed-expired";
  const disabled = state.busy || registrationBusy || voucherBusy || expired || waitSeconds > 0;
  const registering = state.stage === "name" || (registrationIntent && !checkinRequested && state.stage === "phone");
  const retryAt = Math.max(registrationRetryAt ?? 0, state.retryAt ?? 0) || null;

  useEffect(() => {
    if (retryAt === null) return;
    const tick = () => setWaitSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    const stop = setTimeout(() => { clearInterval(timer); tick(); }, Math.max(0, retryAt - Date.now()));
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [retryAt]);

  // No automatic retries. This timer only ends recovery.
  const requestedAt = state.pending?.requestedAt;
  useEffect(() => {
    if (requestedAt === undefined) return;
    const timer = setTimeout(attempt.expire, Math.max(0, requestedAt + RECOVERY_MS + 1 - Date.now()));
    return () => clearTimeout(timer);
  }, [attempt, requestedAt]);

  function reset() {
    if (!attempt.reset()) return;
    setPhone(""); setName(""); setAddress("");
    setCategory(""); setSource(""); setOther(""); setRegistrationError("");
    setPaymentMethod("");
    setReceiptFile(null); setReceiptKey("");
    setVoucher(null);
    setRegistered(false); setCheckinRequested(false); setRegistrationPending(false); registrationRequest.current = null;
  }
  async function createAccount() {
    if (registrationInFlight.current || (registrationRetryAt ?? 0) > Date.now()) return;
    try {
      if (!registrationRequest.current) {
        if (!isCheckinPhone(phone)) throw new Error(CHECKIN_PHONE_ERROR);
        if (!name.trim()) throw new Error("Enter your name.");
        const fields = registrationFields({ rateCategory: category, leadSource: source, leadSourceOther: other });
        registrationRequest.current = { eventId: crypto.randomUUID(), phone, name: name.trim(), address: address.trim(), ...fields };
      }
      registrationInFlight.current = true;
      setRegistrationPending(true);
      setRegistrationBusy(true); setRegistrationError("");
      const result = await attendanceApi<{ personId: string }>("/api/attendance/register", registrationRequest.current);
      if (!result || typeof result.personId !== "string") throw new Error("Could not confirm account creation. Retry the same request.");
      registrationRequest.current = null;
      setRegistrationPending(false);
      setRegistered(true);
    } catch (error) {
      if (error instanceof AttendanceApiError && error.status >= 400 && error.status < 500) {
        registrationRequest.current = null;
        setRegistrationPending(false);
        if (error.status === 429) setRegistrationRetryAt(Date.now() + (error.retryAfterSeconds ?? 60) * 1000);
      }
      setRegistrationError(error instanceof AttendanceApiError && (error.status === 0 || error.status >= 500 || error.code === "invalid-response")
        ? "Could not confirm account creation. Check your connection and retry the same request."
        : error instanceof Error ? error.message : "Could not create your account. Please retry.");
    } finally { registrationInFlight.current = false; setRegistrationBusy(false); }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (voucherBusy) return;
    if (state.pending) { void attempt.retry(); return; }
    if (state.stage === "payment") {
      if (paymentMethod) void attempt.submitDailyPayment(paymentMethod, paymentMethod && paymentMethod !== "cash" && receiptFile ? dailyReceiptUpload(receiptFile, state.phone, receiptKey) : undefined,
        voucher?.voucherSnapshot ? { voucherCode: voucher.voucherSnapshot.code, voucherRevision: voucher.voucherSnapshot.revision, voucherRateRevision: voucher.rateRevision, amountMinor: voucher.amountMinor } : undefined);
      return;
    }
    if (registering) {
      void createAccount();
    }
    else { setVoucher(null); void attempt.submitPhone(phone, "attendance"); }
  }
  async function applyVoucher(code: string) {
    setVoucherBusy(true);
    try {
      if (!code) { setVoucher(null); setReceiptFile(null); setReceiptKey(""); return; }
      const response = await fetch("/api/attendance/voucher", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: state.phone, category, voucherCode: code }) });
      const result = await response.json();
      if (!response.ok) throw new Error(voucherError(result.error));
      setVoucher(result); setReceiptFile(null); setReceiptKey("");
    } finally { setVoucherBusy(false); }
  }
  const progress = registrationBusy ? "Creating your account…" : state.status === "lookup-pending" ? "Looking up your phone number…"
    : state.status === "upload-pending" ? "Saving your private receipt…"
    : state.status === "attendance-pending" ? "Confirming attendance…" : "";
  const person = state.person;
  const membershipExpiry = person?.membershipExpiryMs != null ? Timestamp.fromMillis(person.membershipExpiryMs) : null;
  const receipt: Receipt | null = state.result?.action === "checked-in" ? {
    name: state.displayName, type: person?.type ?? "guest",
    status: person ? effectiveMemberStatusAt({ ...person, membershipExpiry }, state.confirmedAt!) : null,
    membershipExpiry, visitCount: state.result.visitCount, unverified: state.result.unverified,
    paymentMethod: paymentMethod || undefined, paymentName: state.paymentDue?.paymentAccounts?.find(account => account.id === paymentMethod)?.name, paymentAmount: voucher?.amountMinor ?? state.paymentDue?.amountMinor,
  } : null;

  return (
    <EntryShell mode={registered || state.status === "confirmed" ? "complete" : registering ? "register" : state.stage === "payment" ? "payment" : "phone"}
      name={state.displayName || (registered ? name : undefined)} phone={state.phone || (registered ? phone : undefined)} amount={voucher?.amountMinor ?? state.paymentDue?.amountMinor}>
        {!registered && state.status !== "confirmed" && (
          <form onSubmit={submit} aria-busy={state.busy || registrationBusy}>
            <h1 style={headingStyle}>{registering ? "Create account" : state.stage === "payment" ? "Confirm your visit" : "Check in"}</h1>
            <p style={leadStyle}>{registering ? "No payment required. Create your profile for admin verification." : state.stage === "payment" ? "Choose your payment method to complete your check-in." : "Enter your phone number to record your attendance."}</p>
            {state.stage === "payment" ? <>
              <div className={styles.session}><h2>Daily session</h2>
              {state.paymentDue?.expiredMember && <p>Your membership has expired. This daily session records a visit and does not renew membership.</p>}
              {state.paymentDue?.amountMinor === null ? <p>Ask the administrator to set your Student / Regular category before a paid daily session.</p> :
                <><PriceBreakdown quote={voucher ?? { amountMinor: state.paymentDue?.amountMinor ?? 0 }} /><p>Payment remains pending until the administrator confirms it.</p></>}
              </div>
              {state.paymentDue?.amountMinor != null && <VoucherEntry quote={voucher} disabled={locked || voucherBusy} onApply={applyVoucher} />}
              <PaymentChoice value={paymentMethod} onChange={method => { setPaymentMethod(method); setReceiptFile(null); setReceiptKey(""); }} disabled={locked} accounts={state.paymentDue?.paymentAccounts} gcashAvailable={state.paymentDue?.gcashAvailable ?? false} />
            </> : !registering ? (
              <>
                <label htmlFor="phone" style={labelStyle}>Phone number</label>
                <input id="phone" maxLength={11} type="tel" inputMode="numeric" autoComplete="tel" autoFocus
                  required pattern="[0-9]{11}" title="Enter exactly 11 digits."
                  value={phone} disabled={locked} onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 11))}
                  aria-invalid={state.error ? true : undefined} aria-describedby="phone-hint attempt-status attempt-error"
                  style={inputStyle(!!state.error)} />
                <p id="phone-hint" style={{ ...leadStyle, margin: "8px 0 0" }}>Enter exactly 11 digits.</p>
              </>
            ) : (
              <>
                <label htmlFor="name" style={labelStyle}>Name</label>
                <input id="name" maxLength={120} type="text" autoComplete="name" autoFocus value={name}
                  required disabled={locked} onChange={e => setName(e.target.value)}
                  aria-invalid={state.error ? true : undefined} aria-describedby="attempt-status attempt-error"
                  style={inputStyle(!!state.error)} />
                <label htmlFor="registration-phone" style={{ ...labelStyle, marginTop: 16 }}>Phone number</label>
                <input id="registration-phone" maxLength={11} type="tel" inputMode="numeric" autoComplete="tel"
                  required pattern="[0-9]{11}" title="Enter exactly 11 digits." value={phone} disabled={locked}
                  onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 11))} style={inputStyle(!!state.error)} />
                <label htmlFor="address" style={{ ...labelStyle, marginTop: 16 }}>
                  Address <span style={optionalLabelStyle}>(optional)</span>
                </label>
                <textarea id="address" autoComplete="street-address" rows={2} maxLength={500}
                  value={address} disabled={locked} onChange={e => setAddress(e.target.value)} style={textareaStyle} />
                <RegistrationInputs choiceTiles category={category} source={source} other={other} onCategory={setCategory} onSource={setSource} onOther={setOther} disabled={locked} />
                {registrationError && <p role="alert">{registrationError}</p>}
              </>
            )}
            {state.stage === "payment" && paymentMethod && paymentMethod !== "cash" && <>
              <PaymentAccountDetails account={state.paymentDue?.paymentAccounts?.find(account => account.id === paymentMethod)} />
              <ImageUpload label={paymentMethod === "gcash" ? "GCash receipt" : "Payment receipt"} required disabled={locked} file={receiptFile} onChange={file => { setReceiptFile(file); setReceiptKey(crypto.randomUUID()); }} />
              <p className={styles.actionNote}>Upload your receipt to continue. Payment will await admin review.</p>
              <details className={styles.disclosure}><summary>Receipt privacy & retention</summary><p>{RECEIPT_RETENTION_NOTICE}</p></details>
            </>}
            <p id="attempt-status" role="status" aria-live="polite" aria-atomic="true"
              style={{ ...leadStyle, margin: progress ? "12px 0 0" : 0 }}>{progress}</p>
            <div id="attempt-error" role="alert" aria-atomic="true">
              {state.error && <p style={errorStyle}>{state.error}</p>}
            </div>
            {waitSeconds > 0 && <p role="status" style={{ ...leadStyle, margin: "8px 0 0" }}>
              Try again in {waitSeconds} {waitSeconds === 1 ? "second" : "seconds"}.
            </p>}
            <button type="submit" disabled={disabled} style={primaryButton(disabled)}>
              {progress || (expired ? "Attendance unconfirmed" : waitSeconds > 0 ? "Please wait" : state.pending ? "Retry confirmation"
                : state.status === "blocked" ? "Retry" : registering ? "Create account" : "Check in")}
            </button>
            {(state.stage === "name" || state.stage === "payment") && (
              <button type="button" onClick={reset} style={linkButton} disabled={locked}>← Use a different number</button>
            )}
            {onBack && <button type="button" onClick={onBack} style={linkButton} disabled={locked}>← Back to welcome</button>}
          </form>
        )}
        {registered && <div>
          <h1 style={headingStyle}>Account created</h1>
          <p style={leadStyle}>{name}, your account is awaiting admin verification. You can check in with your phone number whenever you are ready.</p>
          <button type="button" style={primaryButton(false)} onClick={() => {
            attempt.reset(); setRegistered(false); setCheckinRequested(true); setRegistrationError("");
          }}>Check in now</button>
          <button type="button" style={linkButton} onClick={() => { reset(); onBack?.(); }}>Done</button>
          <OptionalPhoto phone={phone} />
        </div>}
        {state.status === "confirmed" && receipt && <ReceiptView receipt={receipt} onDone={reset} />}
        {state.status === "confirmed" && receipt?.unverified && <OptionalPhoto phone={state.phone} />}
        {state.status === "confirmed" && state.result?.action === "checked-out" && (
          <CheckedOutView name={state.displayName}
            accidental={state.confirmedAt! - state.result.checkInAtMs < ACCIDENTAL_RESCAN_MS}
            onDone={reset} />
        )}
    </EntryShell>
  );
}

function PaymentChoice({ value, onChange, disabled, gcashAvailable, accounts }: { value: "" | PaymentMethod; onChange(value: PaymentMethod): void; disabled: boolean; gcashAvailable: boolean; accounts?: PaymentAccount[] }) {
  const choices: { id: PaymentMethod; name: string }[] = [{ id: "cash", name: "Cash" }, ...(accounts ?? [{ id: "gcash" as const, name: "GCash" }])];
  return <fieldset className={styles.choices} disabled={disabled}>
    <legend>Daily payment method</legend><div className={styles.choiceGrid}>
      {choices.map(method => <label className={styles.choice} key={method.id}>
        <input type="radio" name="daily-payment" required value={method.id} checked={value === method.id} disabled={disabled || (method.id !== "cash" && !gcashAvailable)} onChange={() => onChange(method.id)} />
        <span><strong>{method.name}</strong>{" "}<small>{method.id === "cash" ? "Pay at the front desk" : gcashAvailable ? "Upload your receipt" : "Receipt setup pending"}</small></span>
      </label>)}
    </div>
  </fieldset>;
}

function ReceiptView({
  receipt,
  onDone,
}: {
  receipt: Receipt;
  onDone: () => void;
}) {
  const isMember = receipt.type === "member";
  const expired = receipt.status === "expired";

  return (
    <div>
      <div
        style={{
          ...badgeStyle,
          background: expired ? C.accentSoft : C.greenSoft,
          color: expired ? C.accentText : C.green,
        }}
      >
        {expired ? "Checked in — membership expired" : "Checked in"}
      </div>

      <p className={styles.lead} style={{ marginTop: 16, marginBottom: 6 }}>You’re checked in</p>
      <h1 style={{ ...headingStyle, marginTop: 0 }}>{receipt.name}</h1>
      <p style={leadStyle}>
        {isMember ? "Member" : "Guest"} · Tibay Gym
      </p>
      {receipt.unverified && <p role="status" style={leadStyle}>
        Awaiting admin verification. You can keep checking in with this phone number.
        Your visits will count toward official attendance once approved.
      </p>}

      <dl style={detailList}>
        {receipt.paymentMethod && <>
          <div style={detailRow}><dt style={detailKey}>Daily session</dt><dd style={detailVal}>{receipt.paymentAmount == null ? "See front desk" : `₱${(receipt.paymentAmount / 100).toFixed(2)}`} · {receipt.paymentName ?? (receipt.paymentMethod === "cash" ? "Cash" : "GCash")}</dd></div>
          <div style={detailRow}><dt style={detailKey}>Payment</dt><dd style={detailVal}>Pending admin confirmation</dd></div>
        </>}
        {isMember ? (
          <>
            <div style={detailRow}>
              <dt style={detailKey}>Status</dt>
              <dd style={{ ...detailVal, color: expired ? C.accentText : C.green }}>
                {receipt.status === "active" ? "Active" : "Expired"}
              </dd>
            </div>
            <div style={detailRow}>
              <dt style={detailKey}>Membership expires</dt>
              <dd style={detailVal}>
                {formatLongDate(receipt.membershipExpiry)}
              </dd>
            </div>
          </>
        ) : (
          <div style={detailRow}>
            <dt style={detailKey}>Visits</dt>
            <dd style={detailVal}>
              {receipt.visitCount}
              {receipt.visitCount === 1 ? " (first visit)" : ""}
            </dd>
          </div>
        )}
      </dl>

      {isMember && expired && (
        <p style={{ ...leadStyle, color: C.accentText }}>
          Your membership has expired — please see the front desk to renew.
        </p>
      )}

      <p style={{ ...leadStyle, fontSize: 12 }}>
        You&apos;re checked in. Nothing is saved on this phone — just scan the
        poster again on your next visit.
      </p>

      <button type="button" onClick={onDone} style={primaryButton(false)}>
        Done
      </button>
    </div>
  );
}

function CheckedOutView({
  name,
  accidental,
  onDone,
}: {
  name: string;
  accidental: boolean;
  onDone: () => void;
}) {
  return (
    <div>
      <div
        style={{
          ...badgeStyle,
          background: accidental ? C.accentSoft : C.panel,
          color: accidental ? C.accentText : C.muted,
        }}
      >
        {accidental ? "Checked out — scanned twice?" : "Checked out"}
      </div>

      <h1 style={{ ...headingStyle, marginTop: 14 }}>{name}</h1>
      <p style={leadStyle}>Tibay Gym</p>

      {accidental ? (
        <p style={{ ...leadStyle, fontSize: 12 }}>
          You checked in just a few seconds ago, and this scan just checked
          you back out. If that wasn&apos;t on purpose, scan the poster again
          to check back in.
        </p>
      ) : (
        <p style={{ ...leadStyle, fontSize: 12 }}>
          You&apos;re checked out. Scan the poster again next time you come in.
        </p>
      )}

      <button type="button" onClick={onDone} style={primaryButton(false)}>
        Done
      </button>
    </div>
  );
}

// --- styles ---------------------------------------------------------------

const headingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 34,
  lineHeight: 1,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "0 0 6px",
};

const leadStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.55,
  color: C.muted,
  margin: "0 0 20px",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 7,
};

function inputStyle(hasError: boolean): CSSProperties {
  return {
    width: "100%",
    height: 50,
    padding: "0 12px",
    border: `1px solid ${hasError ? C.accentText : C.line}`,
    background: C.paper,
    color: C.ink,
    borderRadius: 6,
    outlineOffset: 3,
    fontFamily: bodyFont,
    fontSize: 16,
  };
}

const optionalLabelStyle: CSSProperties = {
  color: C.muted,
  fontWeight: 400,
};

const textareaStyle: CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 76,
  padding: "10px 12px",
  border: `1px solid ${C.line}`,
  background: C.paper,
  color: C.ink,
  borderRadius: 6,
  outlineOffset: 3,
  resize: "vertical",
  fontFamily: bodyFont,
  fontSize: 16,
  lineHeight: 1.45,
};

const errorStyle: CSSProperties = {
  margin: "8px 0 0",
  padding: "9px 11px",
  background: C.accentSoft,
  borderLeft: `2px solid ${C.accentText}`,
  fontSize: 13,
  color: C.accentText,
};

function primaryButton(busy: boolean): CSSProperties {
  return {
    width: "100%",
    height: 48,
    marginTop: 18,
    border: "none",
    borderRadius: 6,
    background: C.accent,
    color: C.onAccent,
    fontFamily: displayFont,
    fontSize: 17,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
  };
}

const linkButton: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 14,
  border: "none",
  background: "transparent",
  padding: 0,
  fontSize: 13,
  color: C.muted,
  cursor: "pointer",
  textAlign: "left",
};

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "5px 10px",
  borderRadius: 4,
  fontFamily: displayFont,
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const detailList: CSSProperties = {
  margin: "18px 0",
  padding: "4px 0",
  borderTop: `1px solid ${C.line}`,
};

const detailRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  padding: "10px 0",
  borderBottom: `1px solid ${C.line}`,
};

const detailKey: CSSProperties = {
  fontSize: 13,
  color: C.muted,
};

const detailVal: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  textAlign: "right",
};
