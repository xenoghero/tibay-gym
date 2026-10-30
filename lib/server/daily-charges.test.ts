import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null }));
vi.mock("./firebase-admin", () => ({ adminDb: () => state.store!.db }));
import { scanAttendance } from "./attendance";
import { confirmDailyCash } from "./daily-charges";
import { approveUnverified } from "./unverified";
import { DEFAULT_SETTINGS } from "@/lib/finance/rules";
import { createHash } from "node:crypto";
import { dailyChargeId } from "./daily-charges";
const NOW = Date.parse("2026-10-25T15:59:00Z");
let sequence = 0;
const qr = (rest = {}) => ({ source: "qr" as const, personId: "p1", requestedAt: Date.now(), eventId: `daily-scan-event-${++sequence}`, paymentMethod: "cash" as const, expectedAmountMinor: 6000, ...rest });
const rows = (collection: string) => [...state.store!.data].filter(([path]) => path.startsWith(`${collection}/`));
beforeEach(() => {
  state.store = memoryFirestore(); sequence = 0; vi.useFakeTimers(); vi.setSystemTime(NOW);
  state.store.data.set("gymSettings/finance", { ...DEFAULT_SETTINGS, financialCutoverAt: NOW - 1, rateRevision: 1 });
  state.store.data.set("persons/p1", { phone: "09123456789", type: "guest", status: null, rateCategory: "student", membershipExpiry: null, visitCount: 0, lastVisitAt: null });
});
afterEach(() => vi.useRealTimers());
it("records a configured bank daily payment and rejects receipts bound to a different method", async () => {
  const bank = { id: "account_bank0001", kind: "bank", name: "BPI savings", accountHolder: "Tibay Gym", accountNumber: "0012345678", enabled: true, qrImage: null };
  state.store!.data.set("gymSettings/payments", { revision: 1, accounts: [bank] });
  const receiptId = "a".repeat(64), receiptToken = "b".repeat(43), chargeId = dailyChargeId("p1", NOW);
  const receipt = { state: "ready", personId: "p1", chargeId, amountMinor: 6000, paymentRequestId: "bank-request-00001", paymentRevision: 1, paymentMethod: "gcash",
    tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 10000, linked: false };
  state.store!.data.set(`receiptIntents/${receiptId}`, receipt);
  const input = qr({ paymentMethod: bank.id, paymentRevision: 1, receiptId, receiptToken });
  await expect(scanAttendance(input)).rejects.toMatchObject({ code: "valid-receipt-required" });
  expect(rows("attendanceLogs")).toHaveLength(0);
  state.store!.data.set(`receiptIntents/${receiptId}`, { ...receipt, paymentMethod: bank.id, paymentRevision: 0 });
  await expect(scanAttendance(input)).rejects.toMatchObject({ code: "valid-receipt-required" });
  state.store!.data.set(`receiptIntents/${receiptId}`, { ...receipt, paymentMethod: bank.id });
  await scanAttendance(input);
  expect(rows("paymentRequests")[0][1]).toMatchObject({ method: bank.id, status: "pending", receiptId, paymentAccountSnapshot: { name: bank.name } });
});
it("creates one pending daily charge atomically and never duplicates it on retries, checkout or return", async () => {
  const first = qr(), result = await scanAttendance(first);
  expect((await scanAttendance(first)).logId).toBe(result.logId);
  vi.setSystemTime(NOW + 30000); expect((await scanAttendance(qr())).action).toBe("checked-out");
  vi.setSystemTime(NOW + 45000); await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "attendance-cooldown" });
  vi.setSystemTime(NOW + 59000); // Still the same Philippine calendar date.
  await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "attendance-cooldown" });
  vi.setSystemTime(NOW + 60000); // Midnight: new date, new charge.
  await scanAttendance(qr());
  expect(rows("charges")).toHaveLength(2); expect(rows("paymentRequests")).toHaveLength(2);
  expect(rows("charges").map(([, data]) => data.chargeDate)).toEqual(["2026-10-25", "2026-10-26"]);
  expect(rows("paymentRequests").every(([, data]) => data.status === "pending")).toBe(true);
});
it("serializes competing check-ins and preserves incurred charge snapshots after rate changes", async () => {
  vi.setSystemTime(NOW - 3600000);
  state.store!.data.get("gymSettings/finance")!.financialCutoverAt = NOW - 7200000;
  const concurrent = await Promise.allSettled([scanAttendance(qr()), scanAttendance(qr())]);
  expect(concurrent.every(result => result.status === "fulfilled")).toBe(true); // Immediate rescan reuses the accepted visit.
  expect(rows("charges")).toHaveLength(1); expect(rows("attendanceLogs")).toHaveLength(1);
  state.store!.data.get("gymSettings/finance")!.studentDailyMinor = 8000;
  vi.setSystemTime(NOW - 3500000); await scanAttendance(qr());
  vi.setSystemTime(NOW - 3400000); await scanAttendance(qr({ paymentMethod: undefined }));
  expect(rows("charges")).toHaveLength(1); expect(rows("charges")[0][1].amountMinor).toBe(6000);
});
it("does not charge covered members, and expired daily visits never extend membership", async () => {
  const person = state.store!.data.get("persons/p1")!;
  person.type = "member"; person.status = "active"; person.membershipExpiry = Timestamp.fromMillis(NOW + 86400000);
  await scanAttendance(qr({ paymentMethod: undefined })); expect(rows("charges")).toHaveLength(0);
  vi.setSystemTime(NOW + 30000); await scanAttendance(qr());
  vi.setSystemTime(NOW + 60000); person.membershipExpiry = Timestamp.fromMillis(NOW - 86400000);
  // Obtain the current stored object, since attendance updates replace test records.
  state.store!.data.get("persons/p1")!.membershipExpiry = person.membershipExpiry;
  await scanAttendance(qr()); expect(rows("charges")).toHaveLength(1);
  expect(state.store!.data.get("persons/p1")!.membershipExpiry).toEqual(person.membershipExpiry);
});
it("rejects missing payment, changed pricing and unavailable GCash without recording attendance", async () => {
  await expect(scanAttendance(qr({ paymentMethod: undefined }))).rejects.toMatchObject({ code: "daily-payment-required" });
  await expect(scanAttendance(qr({ expectedAmountMinor: 7000 }))).rejects.toMatchObject({ code: "daily-price-changed" });
  await expect(scanAttendance(qr({ paymentMethod: "gcash" }))).rejects.toMatchObject({ code: "valid-receipt-required" });
  expect(rows("attendanceLogs")).toHaveLength(0); expect(rows("charges")).toHaveLength(0);
});
it("preserves the same charge through visitor approval and confirms reviewed cash once", async () => {
  state.store!.data.delete("persons/p1");
  await scanAttendance(qr({ guest: { phone: "09123456789", name: "New visitor", address: "", rateCategory: "student", leadSource: "friends", leadSourceOther: null } }));
  const charge = rows("charges")[0][1];
  await approveUnverified("p1", "admin");
  await Promise.all([confirmDailyCash("admin", charge.id as string, 6000), confirmDailyCash("admin", charge.id as string, 6000)]);
  expect(rows("charges")).toHaveLength(1); expect(rows("paymentRequests")).toHaveLength(1);
  expect(rows("paymentRequests")[0][1]).toMatchObject({ status: "approved", confirmedAt: NOW });
  expect(state.store!.data.get("persons/p1")?.type).toBe("guest"); expect(rows("attendanceLogs")).toHaveLength(1);
});
it("keeps pre-cutover attendance free of fabricated charges and rejects unclassified paid visits", async () => {
  state.store!.data.get("gymSettings/finance")!.financialCutoverAt = null;
  await scanAttendance(qr({ paymentMethod: undefined })); expect(rows("charges")).toHaveLength(0);
  vi.setSystemTime(NOW + 30000); await scanAttendance(qr());
  state.store!.data.get("gymSettings/finance")!.financialCutoverAt = NOW;
  state.store!.data.get("persons/p1")!.rateCategory = null;
  vi.setSystemTime(NOW + 60000);
  await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "category-required" });
  expect(rows("charges")).toHaveLength(0);
});
it("allows attendance after a privately bound receipt while leaving GCash pending and cash confirmation unavailable", async () => {
  const receiptId = "a".repeat(64), receiptToken = "b".repeat(43), chargeId = dailyChargeId("p1", NOW);
  state.store!.data.set(`receiptIntents/${receiptId}`, { state: "ready", personId: "p1", chargeId, amountMinor: 6000,
    paymentRequestId: "gcash-request-00001", tokenHash: createHash("sha256").update(receiptToken).digest("hex"), expiresAt: NOW + 10000, linked: false });
  const result = await scanAttendance(qr({ paymentMethod: "gcash", receiptId, receiptToken }));
  expect(result.action).toBe("checked-in"); expect(rows("attendanceLogs")).toHaveLength(1);
  expect(rows("paymentRequests")[0][1]).toMatchObject({ method: "gcash", status: "pending", receiptId });
  expect(state.store!.data.get(`receiptIntents/${receiptId}`)?.linked).toBe(true);
  expect(rows("charges")[0][1].tibayTransactionNumber).toBe("TB-000000000001");
  await expect(confirmDailyCash("admin", chargeId, 6000)).rejects.toMatchObject({ code: "use-payment-review" });
});
it.each(["wrong-owner", "wrong-amount", "expired"])("rejects receipt proof that is %s", async issue => {
  const receiptId = "a".repeat(64), receiptToken = "b".repeat(43), chargeId = dailyChargeId("p1", NOW);
  state.store!.data.set(`receiptIntents/${receiptId}`, { state: "ready", personId: issue === "wrong-owner" ? "other" : "p1", chargeId,
    amountMinor: issue === "wrong-amount" ? 7000 : 6000, paymentRequestId: "gcash-request-00001", tokenHash: createHash("sha256").update(receiptToken).digest("hex"),
    expiresAt: issue === "expired" ? NOW - 1 : NOW + 10000, linked: false });
  await expect(scanAttendance(qr({ paymentMethod: "gcash", receiptId, receiptToken }))).rejects.toMatchObject({ code: "valid-receipt-required" });
  expect(rows("charges")).toHaveLength(0); expect(rows("attendanceLogs")).toHaveLength(0);
});
