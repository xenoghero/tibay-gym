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
  expect(packageOf("p1", student.operationId)).toMatchObject({ personId: "p1", status: "pending", priceMinor: 150_000, sessions: 8, validityDays: 15, sessionsUsed: 0, coachId: null });
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
