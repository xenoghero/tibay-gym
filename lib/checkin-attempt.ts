import { AttendanceApiError } from "./attendance-error";
import { CHECKIN_PHONE_ERROR, isCheckinPhone } from "./checkin-phone";
import type { QrLookupPerson, QrLookupResponse, QrRequest, QrResponse } from "./attendance-api";
import type { ReceiptPreparation } from "./receipt-upload";

export type AttemptStatus = "idle" | "lookup-pending" | "upload-pending" | "ready" | "blocked" |
  "attendance-pending" | "unconfirmed" | "confirmed" | "unconfirmed-expired";
export type AttendanceIntent = "attendance" | "checkout";
type LogicalScan = QrRequest;
export interface AttemptSnapshot {
  status: AttemptStatus;
  busy: boolean;
  stage: "phone" | "name" | "payment";
  dailyRates: import("./attendance-api").DailyRates | null;
  paymentDue: import("./attendance-api").DailyPaymentDue | null;
  phone: string;
  intent: AttendanceIntent;
  person: QrLookupPerson | null;
  displayName: string;
  pending: LogicalScan | null;
  result: QrResponse | null;
  confirmedAt: number | null;
  error: string | null;
  retryAt: number | null;
}
interface Dependencies {
  lookup(body: { phone: string; intent: AttendanceIntent }): Promise<QrLookupResponse>;
  scan(body: QrRequest): Promise<QrResponse>;
  now(): number;
  eventId(): string;
  online(): boolean;
}
const initial = (): AttemptSnapshot => ({ status: "idle", busy: false, stage: "phone", phone: "",
  dailyRates: null, paymentDue: null,
  intent: "attendance", person: null, displayName: "", pending: null, result: null, confirmedAt: null, error: null, retryAt: null });
export const RECOVERY_MS = 30_000;
const expiredMessage = "Attendance is still unconfirmed and the recovery window has ended. Do not start another scan; it could reverse an earlier attendance action.";
// Only verified, definite first-request rejections unlock a new attempt. A retry
// rejection must never erase an earlier uncertain outcome (even for these codes).
// person-unavailable is deliberately excluded: post-commit projection can fail.
const definiteRejections = new Set(["guest-conflict", "rate-limited", "attendance-cooldown", "attendance-not-initialized", "no-open-session", "checkout-session-changed", "category-required", "daily-payment-required", "gcash-unavailable", "registration-fields-required", "daily-price-changed", "valid-receipt-required", "daily-payment-already-submitted", "registration-reuse"]);
for (const code of ["voucher-invalid", "voucher-unavailable", "voucher-not-started", "voucher-expired", "voucher-scope", "voucher-minimum", "voucher-limit", "voucher-customer-limit", "voucher-payable", "voucher-no-discount", "voucher-changed"]) definiteRejections.add(code);

/** In-memory attendance lifecycle with stable request identity for retries. */
export class CheckinAttempt {
  private state = initial();
  private listeners = new Set<() => void>();
  private preparedReceipt: { key: string; request: LogicalScan } | null = null;
  private guestDraft: QrRequest["guest"] | null = null;
  constructor(private deps: Dependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<AttemptSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  reset = (): boolean => {
    if (this.state.busy || this.state.pending) return false;
    this.preparedReceipt = null;
    this.guestDraft = null;
    this.state = { ...initial(), retryAt: this.state.retryAt }; this.listeners.forEach(listener => listener()); return true;
  };
  expire = () => {
    if (this.state.pending && this.deps.now() - this.state.pending.requestedAt > RECOVERY_MS) {
      this.update({ status: "unconfirmed-expired", error: expiredMessage });
    }
  };
  private ensureOnline() {
    if (!this.deps.online()) throw new AttendanceApiError("You're offline. Reconnect, then tap Retry.", "offline", 0);
  }
  private fail(error: unknown, uncertain: boolean) {
    if (error instanceof AttendanceApiError && error.status === 429) {
      this.update({ retryAt: this.deps.now() + (error.retryAfterSeconds ?? 60) * 1000 });
    }
    const message = error instanceof AttendanceApiError
      ? error.message : "Could not confirm the response. Please retry.";
    if (uncertain) {
      this.update({ status: "unconfirmed", error: `Earlier attendance is still unconfirmed. ${message} Keep this page open and retry this same scan; do not start another scan.` });
      if (error instanceof AttendanceApiError && error.code === "retry-expired") {
        this.update({ status: "unconfirmed-expired", error: expiredMessage });
      } else this.expire();
    } else this.update({ status: "blocked", error: message });
  }
  async submitPhone(phone: string, intent: AttendanceIntent, registrationOnly = false) {
    if ((this.state.retryAt ?? 0) > this.deps.now()) return;
    if (this.state.busy || this.state.pending || this.state.status === "confirmed") return;
    if (!isCheckinPhone(phone)) { this.update({ status: "blocked", error: CHECKIN_PHONE_ERROR }); return; }
    this.update({ busy: true, error: null, phone, intent, stage: "phone", person: null });
    try {
      this.ensureOnline();
      this.update({ status: "lookup-pending" });
      const lookup = await this.deps.lookup({ phone, intent });
      this.update({ status: "ready", person: lookup.person, displayName: lookup.person?.name ?? "" });
      this.update({ dailyRates: lookup.dailyRates ?? null, paymentDue: lookup.paymentDue ?? null });
      if (intent === "checkout" && (!lookup.person || !lookup.expectedLogId)) {
        throw new AttendanceApiError("There is no open visit to check out of.", "no-open-session", 409);
      }
      if (!lookup.person) { this.update({ stage: "name" }); return; }
      if (registrationOnly) {
        this.update({ status: "blocked", error: "An account already exists for this number. Choose Check In to record your visit." });
        return;
      }
      if (intent !== "checkout" && lookup.paymentDue) { this.update({ stage: "payment" }); return; }
      await this.send({ personId: lookup.person.id, intent,
        ...(intent === "checkout" ? { expectedLogId: lookup.expectedLogId! } : {}) }, false);
    } catch (error) { this.fail(error, !!this.state.pending); }
    finally { this.update({ busy: false }); }
  }
  async registerGuest(phone: string, name: string, address: string, registration: import("./registration").RegistrationFields) {
    if (!name.trim()) { this.update({ status: "blocked", error: "Enter your name." }); return; }
    await this.submitPhone(phone, "attendance", true);
    if (this.state.status === "ready" && this.state.stage === "name") await this.submitGuest(name, address, registration);
  }
  async submitGuest(name: string, address: string, registration?: import("./registration").RegistrationFields, paymentMethod?: "cash" | "gcash", receipt?: ReceiptPreparation) {
    if ((this.state.retryAt ?? 0) > this.deps.now()) return;
    if (this.state.busy || this.state.pending || this.state.stage !== "name" || this.state.status === "confirmed") return;
    if (!name.trim()) { this.update({ status: "blocked", error: "Enter your name." }); return; }
    if (this.state.dailyRates && registration && !paymentMethod) {
      this.guestDraft = { phone: this.state.phone, name: name.trim(), address: address.trim(), ...registration };
      this.update({ stage: "payment", displayName: name.trim(), error: null, paymentDue: {
        amountMinor: registration.rateCategory === "student" ? this.state.dailyRates.studentDailyMinor : this.state.dailyRates.regularDailyMinor,
        expiredMember: false, gcashAvailable: this.state.dailyRates.gcashAvailable ?? false,
      } });
      return;
    }
    this.update({ busy: true, error: null, displayName: name.trim() });
    try {
      const expectedAmountMinor = this.state.dailyRates && registration ? (registration.rateCategory === "student" ? this.state.dailyRates.studentDailyMinor : this.state.dailyRates.regularDailyMinor) : undefined;
      await this.send({ intent: "attendance", guest: { phone: this.state.phone, name: name.trim(), address: address.trim(), ...registration }, ...(paymentMethod ? { paymentMethod } : {}), ...(expectedAmountMinor ? { expectedAmountMinor } : {}) }, false, receipt);
    } catch (error) { this.fail(error, !!this.state.pending); }
    finally { this.update({ busy: false }); }
  }
  async submitDailyPayment(paymentMethod: "cash" | "gcash", receipt?: ReceiptPreparation, voucher?: { voucherCode: string; voucherRevision: number; voucherRateRevision: number; amountMinor: number }) {
    if (this.state.busy || this.state.pending || this.state.stage !== "payment" || (!this.state.person && !this.guestDraft) || (this.state.retryAt ?? 0) > this.deps.now()) return;
    if (this.state.paymentDue?.amountMinor === null) { this.update({ error: "Ask the administrator to classify your rate category first." }); return; }
    this.update({ busy: true, error: null });
    try { await this.send({ ...(this.guestDraft ? { guest: this.guestDraft } : { personId: this.state.person!.id }), intent: "attendance", paymentMethod,
      expectedAmountMinor: voucher?.amountMinor ?? this.state.paymentDue!.amountMinor!, ...(voucher ? { voucherCode: voucher.voucherCode, voucherRevision: voucher.voucherRevision, voucherRateRevision: voucher.voucherRateRevision } : {}) }, false, receipt); }
    catch (error) { this.fail(error, !!this.state.pending); }
    finally { this.update({ busy: false }); }
  }
  async retry() {
    if ((this.state.retryAt ?? 0) > this.deps.now()) return;
    if (this.state.busy || !this.state.pending || this.state.status === "unconfirmed-expired") return;
    this.expire();
    if (this.getSnapshot().status === "unconfirmed-expired") return;
    this.update({ busy: true, error: null });
    try { await this.send(this.state.pending!, true); }
    catch (error) { this.fail(error, true); }
    finally { this.update({ busy: false }); }
  }
  private async send(target: Partial<LogicalScan>, retry: boolean, receipt?: ReceiptPreparation) {
    this.ensureOnline();
    if (retry) {
      this.expire();
      if (this.state.status === "unconfirmed-expired") return;
    }
    let pending = retry ? this.state.pending! : { ...target, eventId: this.deps.eventId(), requestedAt: this.deps.now() };
    if (!retry && target.paymentMethod === "gcash") {
      if (!receipt) throw new AttendanceApiError("Choose and upload a receipt before submitting GCash.", "valid-receipt-required", 400);
      const key = JSON.stringify([receipt.key, target]);
      if (this.preparedReceipt?.key !== key) this.preparedReceipt = { key, request: pending };
      this.update({ status: "upload-pending" });
      let proof;
      try { proof = await receipt.upload(this.preparedReceipt.request); }
      catch (error) { if (error instanceof AttendanceApiError && error.code === "receipt-expired") this.preparedReceipt = null; throw error; }
      if (!this.preparedReceipt) throw new AttendanceApiError("Prepare a fresh receipt upload.", "receipt-expired", 409);
      pending = { ...this.preparedReceipt.request, ...proof, requestedAt: this.deps.now() };
    }
    this.update({ pending, status: "attendance-pending" });
    try {
      const result = await this.deps.scan(pending);
      if (!result || !["checked-in", "checked-out"].includes(result.action) ||
        !Number.isFinite(result.checkInAtMs) || !Number.isFinite(result.visitCount) ||
        typeof result.personId !== "string" || (pending.personId && result.personId !== pending.personId) ||
        (pending.intent === "checkout" && result.action !== "checked-out")) {
        throw new AttendanceApiError("The response could not be confirmed. Retry the same request.", "invalid-response", 0);
      }
      this.update({ status: "confirmed", pending: null, result, confirmedAt: this.deps.now(), error: null });
    } catch (error) {
      if (!retry && error instanceof AttendanceApiError && definiteRejections.has(error.code)) {
        if (["valid-receipt-required", "daily-price-changed", "registration-reuse"].includes(error.code)) this.preparedReceipt = null;
        this.update({ pending: null, ...(["guest-conflict", "daily-price-changed", "registration-reuse"].includes(error.code) ? { stage: "phone" as const } : {}) });
      }
      throw error;
    }
  }
}
