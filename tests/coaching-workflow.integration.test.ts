import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./memory-firestore";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof import("./memory-firestore").memoryFirestore> | null }));
vi.mock("@/lib/server/firebase-admin", () => ({ adminDb: () => state.store!.db }));
vi.mock("@/lib/server/rfid/rate-limit", () => ({ throttle: vi.fn() }));
vi.mock("@/lib/server/public-rate-limit", () => ({ publicCaller: () => "synthetic", publicRateLimiter: { consume: vi.fn() } }));
import { getPurchaseQuote, submitPurchase, paymentReviewPreview, decidePayment, abandonPurchase, purchaseChargeId } from "@/lib/server/purchases";
import { customerCoaching, getCoachingSettings, saveCoachingSettings } from "@/lib/server/coaching";
import { financeReport } from "@/lib/server/finance-report";
import { POST as scan } from "@/app/api/attendance/scan/route";
import { adjustSessions, fixMark, markSession, monthlyCoachCounts, sessionHistory, undoMark } from "@/lib/server/session-marks";
import { assignCoach } from "@/lib/server/coach-clients";
import { POST as signup } from "@/app/api/coaching/signup/route";
import { GET as purchaseQuote, POST as purchaseSubmit } from "@/app/api/customer/purchase/route";
import { GET as customerPayments } from "@/app/api/customer/payments/route";
import { voucherFixture } from "./voucher-fixture";
import { POST as lookup } from "@/app/api/attendance/lookup/route";

const NOW = Date.parse("2026-11-17T02:00:00Z");
const rows = (name: string) => [...state.store!.data].filter(([path]) => path.startsWith(`${name}/`)).map(([, value]) => value);
const packageOf = (personId: string, operation: string) => state.store!.data.get(`coachingPackages/${purchaseChargeId(personId, operation)}`);
let sequence = 0;
async function buy(personId = "p1", packageId = "pkg-8", extra: Record<string, unknown> = {}) {
  const quote = await getPurchaseQuote(personId, undefined, undefined, undefined, packageId);
  const operationId = `coaching-operation-${++sequence}-0000`;
  return { quote, operationId, ...await submitPurchase(`customer:${personId}`, personId, { method: "cash", packageId, quoteToken: quote.quoteToken, operationId, ...extra }) };
}
async function decide(id: string, decision = "approve") {
  const preview = await paymentReviewPreview(id);
  return decidePayment("admin", { paymentRequestId: id, decision, reviewed: true, previewToken: preview.previewToken, reason: "Cash not received" });
}
beforeEach(() => {
  state.store = memoryFirestore(); sequence = 0; vi.useFakeTimers(); vi.setSystemTime(NOW);
  state.store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: NOW - 1, studentMonthlyMinor: 100000, regularMonthlyMinor: 120000 });
  state.store.data.set("persons/p1", { name: "Client", phone: "09123456789", type: "guest", status: null, rateCategory: "student", membershipExpiry: null, visitCount: 0, lastVisitAt: null, rfidTagId: null });
  state.store.data.set("persons/p2", { name: "Member", phone: "09123456780", type: "member", status: "active", rateCategory: "regular", membershipExpiry: Timestamp.fromMillis(Date.parse("2026-11-21T16:00:00Z")), visitCount: 0, lastVisitAt: null, rfidTagId: null });
});
afterEach(() => vi.useRealTimers());

it("buys a package at one price for every Rate category, copies its terms and approves it as not started", async () => {
  const student = await buy("p1", "pkg-8"), regular = await buy("p2", "pkg-8");
  expect([student.quote.amountMinor, regular.quote.amountMinor]).toEqual([150_000, 150_000]);
  expect(student.quote).toMatchObject({ kind: "coaching_package", coverage: null, coachingPackage: { packageId: "pkg-8", sessions: 8, validityDays: 15 } });
  expect(packageOf("p1", student.operationId)).toMatchObject({ personId: "p1", status: "pending", priceMinor: 150_000, sessions: 8, validityDays: 15, sessionsUsed: 0 });
  expect(await customerCoaching("p1")).toMatchObject({ canBuy: false, current: { status: "pending", sessions: 8, sessionsLeft: 8, validityDays: 15 } });
  expect(rows("membershipPurchaseState")).toHaveLength(0);

  await decide(student.id);
  expect(packageOf("p1", student.operationId)).toMatchObject({ status: "approved", approvedAt: NOW, startedAt: null });
  // Approval grants no membership by itself: the month starts with the package (#15).
  expect(state.store!.data.get("persons/p1")).toMatchObject({ type: "guest", membershipExpiry: null });
  expect(rows("auditEvents").map(event => event.action)).toEqual(expect.arrayContaining(["coaching-purchase-submitted", "payment-approved"]));

  // Catalog edits apply only to new purchases.
  const settings = await getCoachingSettings();
  await saveCoachingSettings("admin", { revision: settings.revision, packages: settings.packages.map(p => p.id === "pkg-8" ? { ...p, priceMinor: 160_000, sessions: 9 } : p) });
  expect(packageOf("p1", student.operationId)).toMatchObject({ priceMinor: 150_000, sessions: 8 });
  expect(rows("auditEvents").find(event => event.action === "coaching-catalog-update")).toMatchObject({ reason: "pkg-8: PHP 1500, 8 sessions, 15 days, visible -> PHP 1600, 9 sessions, 15 days, visible" });

  const report = await financeReport(new URLSearchParams({ date: "2026-11-17" }));
  expect(report.breakdown.find(row => row.kind === "coaching_package")).toMatchObject({ expectedMinor: 150_000, confirmedMinor: 150_000, confirmedCount: 1 });
  expect(report.outstanding).toMatchObject({ coachingPackageMinor: 150_000, newMembershipMinor: 0, renewalMinor: 0 });
});

it("allows only one package that is pending, not started, or active with sessions left", async () => {
  const first = await buy();
  await expect(getPurchaseQuote("p1", undefined, undefined, undefined, "pkg-4")).rejects.toMatchObject({ code: "coaching-package-active" });
  await decide(first.id);
  await expect(buy("p1", "pkg-4")).rejects.toMatchObject({ code: "coaching-package-active" });
  state.store!.data.set(`coachingPackages/${purchaseChargeId("p1", first.operationId)}`, { ...packageOf("p1", first.operationId), status: "active", sessionsUsed: 8 });
  await expect(buy("p1", "pkg-4")).resolves.toMatchObject({ id: expect.any(String) });
});

it("keeps resubmit after a rejection and frees the slot when the purchase is closed", async () => {
  const first = await buy();
  await decide(first.id, "reject");
  expect(packageOf("p1", first.operationId)).toMatchObject({ status: "rejected" });
  const replacementQuote = await getPurchaseQuote("p1", first.id);
  expect(replacementQuote).toMatchObject({ kind: "coaching_package", amountMinor: 150_000, coachingPackage: { sessions: 8 } });
  const replacement = await submitPurchase("customer:p1", "p1", { method: "cash", previousRequestId: first.id, quoteToken: replacementQuote.quoteToken, operationId: "coaching-replacement-0001" });
  expect(packageOf("p1", first.operationId)).toMatchObject({ status: "pending", paymentRequestId: replacement.id });
  await decide(replacement.id, "reject");
  await abandonPurchase("admin", { chargeId: purchaseChargeId("p1", first.operationId), paymentRequestId: replacement.id, reason: "Client changed their mind", confirmed: true });
  expect(packageOf("p1", first.operationId)).toMatchObject({ status: "closed" });
  expect(await customerCoaching("p1")).toMatchObject({ current: null, canBuy: true });
  await expect(buy("p1", "pkg-4")).resolves.toMatchObject({ id: expect.any(String) });
});

it("refuses hidden packages, deleted packages and unclassified customers", async () => {
  const settings = await getCoachingSettings();
  await saveCoachingSettings("admin", { revision: 0, packages: settings.packages.map(p => p.id === "pkg-4" ? { ...p, visible: false } : p) });
  expect((await customerCoaching("p1")).packages.map(p => p.id)).toEqual(["pkg-8", "pkg-12", "pkg-16"]);
  await expect(buy("p1", "pkg-4")).rejects.toMatchObject({ code: "coaching-package-unavailable" });
  await expect(saveCoachingSettings("admin", { revision: 1, packages: settings.packages.slice(1) })).rejects.toMatchObject({ code: "coaching-package-delete-forbidden" });
  state.store!.data.set("persons/p1", { ...state.store!.data.get("persons/p1"), rateCategory: null });
  await expect(buy("p1", "pkg-8")).rejects.toMatchObject({ code: "category-required" });
});

it("leaves membership purchases on their own lock alongside a coaching package", async () => {
  await buy();
  const quote = await getPurchaseQuote("p1");
  expect(quote.kind).toBe("new_membership");
  await expect(submitPurchase("customer:p1", "p1", { method: "cash", quoteToken: quote.quoteToken, operationId: "membership-alongside-001" })).resolves.toMatchObject({ id: expect.any(String) });
});

const post = (body: unknown) => new Request("https://synthetic.test/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const checkIn = async (personId: string, eventId: string) => (await scan(post({ personId, eventId, requestedAt: Date.now() }))).json();
const expiryOf = (personId: string) => (state.store!.data.get(`persons/${personId}`)!.membershipExpiry as Timestamp).toMillis();

it("starts an approved package at the first check-in and covers that visit with the membership month", async () => {
  const bought = await buy("p1", "pkg-4");
  await decide(bought.id);
  vi.setSystemTime(NOW + 2 * 86400000);
  const looked = await (await lookup(post({ phone: "09123456789" }))).json();
  expect(looked.paymentDue).toBeUndefined();
  expect(looked.person.coaching).toMatchObject({ status: "approved", sessionsLeft: 4 });
  const visit = await checkIn("p1", "first-coaching-visit-01");
  expect(visit).toMatchObject({ action: "checked-in", coaching: { status: "active", sessionsLeft: 4, started: true } });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ status: "active", startedAt: NOW + 2 * 86400000, coachingExpiresAt: Date.parse("2026-11-25T16:00:00Z") });
  // Nov 19 + one month: gym access runs on its own clock, past the 7-day coaching validity.
  expect(state.store!.data.get("persons/p1")).toMatchObject({ type: "member", status: "active" });
  expect(expiryOf("p1")).toBe(Date.parse("2026-12-18T16:00:00Z"));
  expect(rows("charges").filter(charge => charge.kind === "daily_session")).toHaveLength(0);
  // The included month is not a membership sale.
  const report = await financeReport(new URLSearchParams({ date: "2026-11-19" }));
  expect(report.totals).toMatchObject({ newMembershipMinor: 0, renewalMinor: 0 });
  vi.setSystemTime(NOW + 2 * 86400000 + 60 * 60000);
  await checkIn("p1", "checkout-coaching-visit-1");
  vi.setSystemTime(NOW + 3 * 86400000);
  expect(await checkIn("p1", "second-coaching-visit-01")).toMatchObject({ coaching: { started: false } });
  // Unused sessions expire with the coaching validity.
  vi.setSystemTime(Date.parse("2026-11-25T16:00:00Z"));
  expect((await customerCoaching("p1")).current).toMatchObject({ status: "expired", sessionsLeft: 0 });
  expect((await customerCoaching("p1")).canBuy).toBe(true);
});

it("adds the membership month after an existing member's current expiry", async () => {
  const bought = await buy("p2", "pkg-8");
  await decide(bought.id);
  await checkIn("p2", "member-coaching-visit-01");
  expect(packageOf("p2", bought.operationId)).toMatchObject({ status: "active", startedAt: NOW });
  // Paid through Nov 21 (expiry Nov 22 00:00 Manila): the package month runs Nov 22 to Dec 22.
  expect(expiryOf("p2")).toBe(Date.parse("2026-12-21T16:00:00Z"));
});

it("starts an unused package automatically at approval + 15 days, dated at the deadline", async () => {
  const bought = await buy("p1", "pkg-12");
  await decide(bought.id);
  vi.setSystemTime(NOW + 20 * 86400000);
  expect((await customerCoaching("p1")).current).toMatchObject({ status: "active", sessionsLeft: 12 });
  const deadline = NOW + 15 * 86400000;
  expect(packageOf("p1", bought.operationId)).toMatchObject({ status: "active", startedAt: deadline, coachingExpiresAt: Date.parse("2027-01-10T16:00:00Z") });
  expect(expiryOf("p1")).toBe(Date.parse("2027-01-01T16:00:00Z"));
  expect(rows("auditEvents").find(event => event.action === "coaching-package-started")).toMatchObject({ actorId: "system:coaching-auto-start" });
});

let markSequence = 0;
const mark = (coachId: string, extra: Record<string, unknown> = {}) => markSession(coachId, { personId: "p1", outcome: "done", operationId: `mark-operation-${++markSequence}-000`, ...extra });
async function coachedClient(packageId = "pkg-4") {
  for (const id of ["ana", "ben"]) state.store!.data.set(`coaches/${id}`, { name: id === "ana" ? "Ana" : "Ben", email: `${id}@example.com`, active: true, createdAt: NOW, deactivatedAt: null });
  const bought = await buy("p1", packageId);
  await decide(bought.id);
  await assignCoach("admin", { personId: "p1", coachId: "ana" });
  return bought;
}

it("marks sessions, starts the package on the first one, and refuses marks that can't be used", async () => {
  const bought = await coachedClient();
  vi.setSystemTime(NOW + 86400000);
  await mark("ana", { note: "Squats and rows" });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ status: "active", startedAt: NOW + 86400000, sessionsUsed: 1 });
  expect(state.store!.data.get("persons/p1")).toMatchObject({ type: "member", status: "active" });
  await mark("ana", { outcome: "no_show", note: "Overslept" });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 1 });
  // Retrying the same request records it once.
  await markSession("ana", { personId: "p1", outcome: "done", operationId: "mark-retry-operation-01" });
  await markSession("ana", { personId: "p1", outcome: "done", operationId: "mark-retry-operation-01" });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 2 });
  await expect(mark("ben")).rejects.toMatchObject({ code: "client-not-assigned" });
  await expect(mark("ana", { date: "2026-12-30" })).rejects.toMatchObject({ code: "invalid-session-date" });
  await mark("ana"); await mark("ana");
  await expect(mark("ana")).rejects.toMatchObject({ code: "no-sessions-left" });
  // A No-show needs no session.
  await expect(mark("ana", { outcome: "no_show" })).resolves.toMatchObject({ outcome: "no_show" });
  const history = await sessionHistory("p1");
  expect(history.filter(row => row.outcome === "done")).toHaveLength(4);
  expect(history.find(row => row.note === "Squats and rows")).toMatchObject({ coachName: "Ana", date: "2026-11-18" });
});

it("refuses marks after the coaching validity ends", async () => {
  await coachedClient();
  await mark("ana");
  vi.setSystemTime(Date.parse("2026-11-23T16:00:00Z"));
  await expect(mark("ana")).rejects.toMatchObject({ code: "coaching-expired" });
});

it("lets the coach undo only on the same Manila day, and the admin undo or fix any mark, audited", async () => {
  const bought = await coachedClient("pkg-8");
  const first = await mark("ana"), second = await mark("ana");
  await undoMark({ coachId: "ana" }, { markId: first.id });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 1 });
  vi.setSystemTime(Date.parse("2026-11-17T16:00:00Z"));
  await expect(undoMark({ coachId: "ana" }, { markId: second.id })).rejects.toMatchObject({ code: "mark-undo-closed" });
  await fixMark("admin", { markId: second.id, outcome: "no_show", note: "Was actually absent" });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 0 });
  await fixMark("admin", { markId: second.id, outcome: "done" });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 1 });
  await undoMark({ adminId: "admin" }, { markId: second.id });
  expect(packageOf("p1", bought.operationId)).toMatchObject({ sessionsUsed: 0 });
  expect(rows("auditEvents").map(event => event.action)).toEqual(expect.arrayContaining(["session-mark-fixed", "session-mark-undone"]));
});

it("records Session adjustments with a reason and keeps marks credited after reassignment", async () => {
  const bought = await coachedClient("pkg-8");
  await mark("ana"); await mark("ana", { outcome: "no_show" });
  await assignCoach("admin", { personId: "p1", coachId: "ben" });
  await mark("ben");
  expect(await monthlyCoachCounts("2026-11")).toEqual({ month: "2026-11", coaches: [
    { coachId: "ana", name: "Ana", done: 1, noShows: 1 }, { coachId: "ben", name: "Ben", done: 1, noShows: 0 }] });
  const recordId = purchaseChargeId("p1", bought.operationId);
  await expect(adjustSessions("admin", { packageRecordId: recordId, sessionsLeft: 3, reason: " " })).rejects.toMatchObject({ code: "adjustment-reason-required" });
  await adjustSessions("admin", { packageRecordId: recordId, sessionsLeft: 3, reason: "Coach marked two sessions by mistake" });
  expect((await customerCoaching("p1")).current).toMatchObject({ sessionsLeft: 3 });
  expect(rows("auditEvents").find(event => event.action === "session-adjustment")).toMatchObject({
    relevantBefore: { sessionsLeft: 6 }, relevantAfter: { sessionsLeft: 3 }, reason: "Coach marked two sessions by mistake" });
});

const signupBody = (extra: Record<string, unknown> = {}) => ({ operationId: "coaching-signup-operation-01", name: "New Client", phone: "09170000001", rateCategory: "regular",
  fbName: "New Client FB", startDate: "2026-11-20", weekdays: ["mon", "wed", "fri"], timeSlot: "evening", address: "Secret address", goals: "Lose weight", remarks: "", ...extra });
const portal = (path: string, cookie: string, body?: unknown) => new Request(`https://synthetic.test${path}`, { method: body ? "POST" : "GET",
  headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

async function signUpAndPay() {
  state.store!.data.set("vouchers/voucher-1", { ...voucherFixture({ kinds: ["coaching_package"] }) });
  state.store!.data.set("voucherCodeClaims/TRAIN10", { voucherId: "voucher-1" });
  const response = await signup(post(signupBody()));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  expect(cookie).toMatch(/^tibay_customer=/);
  const { personId } = await response.json();
  const quote = await (await purchaseQuote(portal("/api/customer/purchase?packageId=pkg-8&voucherCode=TRAIN10", cookie))).json();
  expect(quote).toMatchObject({ kind: "coaching_package", amountMinor: 135000, discountAmountMinor: 15000 });
  const submitted = await purchaseSubmit(portal("/api/customer/purchase", cookie, { method: "cash", packageId: "pkg-8", voucherCode: "TRAIN10", quoteToken: quote.quoteToken, operationId: "signup-purchase-operation" }));
  expect(submitted.status).toBe(200);
  return { personId, cookie, payment: await submitted.json() };
}

it("signs up from the link, pays with a voucher, and sees the pending payment in the portal", async () => {
  const { personId, cookie } = await signUpAndPay();
  expect(state.store!.data.get(`unverifiedPersons/${personId}`)).toMatchObject({ name: "New Client", phone: "09170000001", rateCategory: "regular", leadSource: "facebook",
    coachingProfile: { fbName: "New Client FB", startDate: "2026-11-20", goals: "Lose weight", remarks: null, preferredSchedule: { weekdays: ["mon", "wed", "fri"], timeSlot: "evening" } } });
  const payments = await (await customerPayments(portal("/api/customer/payments", cookie))).json();
  expect(payments.requests).toEqual([expect.objectContaining({ status: "pending", kind: "coaching_package", amountMinor: 135000, voucherCode: "TRAIN10" })]);
  // Unverified profiles may buy coaching only.
  const membership = await purchaseQuote(portal("/api/customer/purchase", cookie));
  expect([membership.status, (await membership.json()).error]).toEqual([409, "verified-profile-required"]);
});

it("verifies the profile when the first coaching payment is approved, and leaves it unverified when rejected", async () => {
  const { personId, payment } = await signUpAndPay();
  await decide(payment.id, "reject");
  expect(state.store!.data.has(`unverifiedPersons/${personId}`)).toBe(true);
  expect(state.store!.data.has(`persons/${personId}`)).toBe(false);
  const replacementQuote = await getPurchaseQuote(personId, payment.id);
  const replacement = await submitPurchase(`customer:${personId}`, personId, { method: "cash", previousRequestId: payment.id, quoteToken: replacementQuote.quoteToken, operationId: "signup-replacement-0001" });
  await decide(replacement.id);
  expect(state.store!.data.has(`unverifiedPersons/${personId}`)).toBe(false);
  expect(state.store!.data.get(`persons/${personId}`)).toMatchObject({ name: "New Client", leadSource: "facebook", verifiedBy: "admin",
    coachingProfile: { fbName: "New Client FB", goals: "Lose weight", preferredSchedule: { weekdays: ["mon", "wed", "fri"], timeSlot: "evening" } } });
  expect(state.store!.data.get(`profileDetails/${personId}`)).toMatchObject({ address: "Secret address" });
  expect(state.store!.data.get(`coachingPackages/${payment.chargeId}`)).toMatchObject({ status: "approved", personId });
});

it("refuses a phone that already has a profile without changing it, and validates required fields", async () => {
  const before = structuredClone(state.store!.data.get("persons/p1"));
  const taken = await signup(post(signupBody({ phone: "09123456789" })));
  expect([taken.status, (await taken.json()).error]).toEqual([409, "phone-already-registered"]);
  expect(state.store!.data.get("persons/p1")).toEqual(before);
  for (const [field, value] of [["fbName", ""], ["weekdays", []], ["weekdays", ["sat"]], ["timeSlot", "night"], ["startDate", "2026-11-01"], ["rateCategory", undefined]] as const) {
    const response = await signup(post(signupBody({ operationId: `invalid-signup-${field}-${String(value).length}`, [field]: value })));
    expect([response.status, (await response.json()).error]).toEqual([400, `signup-invalid-${field}`]);
  }
  expect(rows("unverifiedPersons")).toHaveLength(0);
});
