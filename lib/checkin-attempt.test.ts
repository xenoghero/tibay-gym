import { beforeEach, expect, it, vi } from "vitest";
import { CheckinAttempt } from "./checkin-attempt";
import { AttendanceApiError } from "./attendance-error";
import type { QrLookupResponse, QrResponse } from "./attendance-api";

const person = { id: "member-1", name: "Alex", type: "member" as const, status: "active" as const,
  membershipExpiryMs: 999999, visitCount: 4 };
const confirmation: QrResponse = { action: "checked-in", personId: person.id, checkInAtMs: 1000, visitCount: 5 };
let now: number;
let online: boolean;
let attempt: CheckinAttempt;
const lookup = vi.fn<() => Promise<QrLookupResponse>>();
const scan = vi.fn<() => Promise<QrResponse>>();
const eventId = vi.fn(() => "event-abcdefghijklmnop");
beforeEach(() => {
  vi.resetAllMocks(); now = 1000; online = true;
  lookup.mockResolvedValue({ person }); scan.mockResolvedValue(confirmation);
  eventId.mockReturnValue("event-abcdefghijklmnop");
  attempt = new CheckinAttempt({ lookup, scan, eventId, now: () => now, online: () => online });
});
const uncertain = () => scan.mockRejectedValueOnce(new AttendanceApiError("Connection lost.", "network-unconfirmed", 0));
it("account creation with an existing phone cannot record attendance", async () => {
  await attempt.registerGuest("09123456789", "Sam", "", { rateCategory: "student", leadSource: "friends", leadSourceOther: null });
  expect(scan).not.toHaveBeenCalled();
  expect(attempt.getSnapshot().error).toMatch(/account already exists/);
});
it("a new guest's separate daily payment retains profile and payment identity during recovery", async () => {
  lookup.mockResolvedValue({ person: null, dailyRates: { studentDailyMinor: 6000, regularDailyMinor: 8000 } });
  await attempt.registerGuest("09123456789", "Sam", "Street", { rateCategory: "student", leadSource: "friends", leadSourceOther: null });
  expect(scan).not.toHaveBeenCalled();
  expect(attempt.getSnapshot()).toMatchObject({ stage: "payment", paymentDue: { amountMinor: 6000 } });
  uncertain();
  await attempt.submitDailyPayment("cash");
  await attempt.retry();
  expect(scan.mock.calls[0]).toEqual(scan.mock.calls[1]);
  expect(scan).toHaveBeenCalledWith(expect.objectContaining({ guest: expect.objectContaining({ name: "Sam", phone: "09123456789" }), paymentMethod: "cash", expectedAmountMinor: 6000 }));
});
it.each(["", "0912345678", "091234567890", "0912345678a", "+9123456789", "09123 56789", " 09123456789 ", "０９１２３４５６７８９"])(
  "rejects invalid phone %j before lookup or attendance", async phone => {
    await attempt.submitPhone(phone, "attendance");
    expect(attempt.getSnapshot()).toMatchObject({ status: "blocked", pending: null });
    expect(attempt.getSnapshot().error).toMatch(/11-digit/);
    expect(lookup).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
  },
);
it("starts idle without lookup, scan, or Firebase work", () => {
  expect(attempt.getSnapshot().status).toBe("idle");
  expect(lookup).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
});
it("submits exact phone lookup and attendance without device position", async () => {
  const states: string[] = [];
  attempt.subscribe(() => states.push(attempt.getSnapshot().status));
  await attempt.submitPhone("09123456789", "attendance");
  expect(lookup).toHaveBeenCalledWith({ phone: "09123456789", intent: "attendance" });
  expect(scan).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: 1000, personId: person.id }));
  expect(states).toEqual(expect.arrayContaining(["lookup-pending", "ready", "attendance-pending", "confirmed"]));
  expect(attempt.getSnapshot().pending).toBeNull();
  expect(JSON.stringify(attempt.getSnapshot())).not.toMatch(/latitude|longitude|accuracyMeters|capturedAtMs/);
});
it("keeps guest capture after a long guest-form delay", async () => {
  lookup.mockResolvedValue({ person: null });
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "ready", stage: "name" });
  now += 90000;
  await attempt.submitGuest(" Sam ", " Street ");
  expect(scan).toHaveBeenCalledWith(expect.objectContaining({ requestedAt: now,
    guest: { name: "Sam", phone: "09123456789", address: "Street" } }));
});
it("waits for reviewed daily payment selection and preserves the submitted amount on retry", async () => {
  lookup.mockResolvedValue({ person, paymentDue: { amountMinor: 6000, expiredMember: true, gcashAvailable: false } });
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot().stage).toBe("payment"); expect(scan).not.toHaveBeenCalled();
  uncertain(); await attempt.submitDailyPayment("cash"); await attempt.retry();
  expect(scan).toHaveBeenNthCalledWith(1, expect.objectContaining({ personId: person.id, paymentMethod: "cash", expectedAmountMinor: 6000 }));
  expect(scan.mock.calls[1]).toEqual(scan.mock.calls[0]);
});
it("recovers the same receipt-upload identity before submitting fresh attendance and keeps proof stable afterward", async () => {
  lookup.mockResolvedValue({ person, paymentDue: { amountMinor: 6000, expiredMember: false, gcashAvailable: true } });
  await attempt.submitPhone("09123456789", "attendance");
  const upload = vi.fn().mockRejectedValueOnce(new AttendanceApiError("Upload interrupted", "receipt-upload-unconfirmed", 0))
    .mockResolvedValue({ receiptId: "a".repeat(64), receiptToken: "b".repeat(43) });
  await attempt.submitDailyPayment("gcash", { key: "file-1", upload });
  expect(scan).not.toHaveBeenCalled(); expect(attempt.getSnapshot().pending).toBeNull();
  now += 90000; uncertain(); await attempt.submitDailyPayment("gcash", { key: "file-1", upload });
  expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
  expect(scan).toHaveBeenLastCalledWith(expect.objectContaining({ requestedAt: now, receiptId: "a".repeat(64), receiptToken: "b".repeat(43) }));
  await attempt.retry(); expect(scan.mock.calls[1]).toEqual(scan.mock.calls[0]); expect(upload).toHaveBeenCalledTimes(2);
});
it("checkout-only lookup, submission and retry preserve the same session", async () => {
  lookup.mockResolvedValue({ person, expectedLogId: "log-1" });
  uncertain();
  await attempt.submitPhone("09123456789", "checkout");
  scan.mockResolvedValue({ ...confirmation, action: "checked-out" });
  await attempt.retry();

  expect(lookup).toHaveBeenCalledWith({ phone: "09123456789", intent: "checkout" });
  expect(scan).toHaveBeenNthCalledWith(2, expect.objectContaining({ intent: "checkout", expectedLogId: "log-1" }));
  expect(scan.mock.calls[0]).toEqual(scan.mock.calls[1]);
  expect(attempt.getSnapshot().status).toBe("confirmed");
});
it("checkout with no open session cannot fall into guest capture or scan", async () => {
  lookup.mockResolvedValue({ person: null, expectedLogId: null });
  await attempt.submitPhone("09123456789", "checkout");
  expect(attempt.getSnapshot()).toMatchObject({ status: "blocked", stage: "phone", pending: null });
  expect(scan).not.toHaveBeenCalled();
});
it("blocks duplicate submissions while lookup is pending", async () => {
  let release!: (value: QrLookupResponse) => void;
  lookup.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const first = attempt.submitPhone("09123456789", "attendance");
  await attempt.submitPhone("different", "checkout");
  release({ person }); await first;
  expect(lookup).toHaveBeenCalledOnce(); expect(scan).toHaveBeenCalledOnce();
});
it("preserves the complete request identity on a lost response", async () => {
  uncertain(); await attempt.submitPhone("09123456789", "attendance");
  const pending = attempt.getSnapshot().pending;
  expect(attempt.reset()).toBe(false);
  await attempt.submitPhone("someone-else", "checkout");
  await attempt.retry();
  expect(eventId).toHaveBeenCalledOnce(); expect(lookup).toHaveBeenCalledOnce();
  expect(scan).toHaveBeenNthCalledWith(2, pending);
  expect(attempt.getSnapshot().status).toBe("confirmed");
});
it.each(["guest-conflict", "rate-limited", "attendance-not-initialized"])(
  "a first %s rejection allows a safe manual retry", async code => {
    scan.mockRejectedValueOnce(new AttendanceApiError("Try again.", code, 409));
    await attempt.submitPhone("09123456789", "attendance");
    expect(attempt.getSnapshot()).toMatchObject({ status: "blocked", pending: null });
    expect(attempt.reset()).toBe(true);
  },
);
it("expired uncertain scans cannot be reset, retried or replaced", async () => {
  uncertain(); await attempt.submitPhone("09123456789", "attendance");
  const pending = attempt.getSnapshot().pending;
  now += 30001; attempt.expire();
  await attempt.retry(); await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "unconfirmed-expired", pending });
  expect(attempt.reset()).toBe(false); expect(scan).toHaveBeenCalledOnce(); expect(eventId).toHaveBeenCalledOnce();
  expect(attempt.getSnapshot().error).not.toMatch(/front desk|RFID/);
});
it("offline before submission makes no request; offline recovery retains uncertainty", async () => {
  online = false; await attempt.submitPhone("09123456789", "attendance");
  expect(lookup).not.toHaveBeenCalled();
  expect(attempt.getSnapshot().error).toMatch(/offline/);
  online = true; uncertain(); await attempt.submitPhone("09123456789", "attendance");
  online = false; await attempt.retry();
  expect(attempt.getSnapshot().status).toBe("unconfirmed"); expect(scan).toHaveBeenCalledOnce();
});
it("accepts only backend confirmation and clears the completed attempt on Done", async () => {
  await attempt.submitPhone("09123456789", "attendance");
  await attempt.submitPhone("09123456789", "attendance");
  expect(scan).toHaveBeenCalledOnce(); expect(attempt.reset()).toBe(true);
  expect(attempt.getSnapshot()).toMatchObject({ status: "idle", pending: null, result: null, phone: "" });
});
it("invalid success bodies remain uncertain rather than showing a receipt", async () => {
  scan.mockResolvedValue({ ...confirmation, personId: "different-person" });
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot()).toMatchObject({ status: "unconfirmed", result: null });
  expect(attempt.reset()).toBe(false);
});
it("a first guest conflict safely returns to phone lookup without locking the failed event", async () => {
  lookup.mockResolvedValueOnce({ person: null });
  await attempt.submitPhone("09123456789", "attendance");
  scan.mockRejectedValueOnce(new AttendanceApiError("Look up the number again.", "guest-conflict", 409));
  await attempt.submitGuest("Sam", "Street");
  expect(attempt.getSnapshot()).toMatchObject({ status: "blocked", stage: "phone", pending: null });
  await attempt.submitPhone("09123456789", "attendance");
  expect(attempt.getSnapshot().status).toBe("confirmed");
});
it("a server retry-expired response locks the unresolved event even before the local deadline", async () => {
  uncertain(); await attempt.submitPhone("09123456789", "attendance");
  const pending = attempt.getSnapshot().pending;
  scan.mockRejectedValueOnce(new AttendanceApiError("Recovery ended.", "retry-expired", 409));
  await attempt.retry();
  expect(attempt.getSnapshot()).toMatchObject({ status: "unconfirmed-expired", pending });
  expect(attempt.reset()).toBe(false);
});
it("an uncertain retry never unlocks on a definite first-request error", async () => {
  uncertain(); await attempt.submitPhone("09123456789", "attendance");
  scan.mockRejectedValueOnce(new AttendanceApiError("Wait a moment.", "rate-limited", 429));
  await attempt.retry();
  expect(attempt.getSnapshot().status).toBe("unconfirmed");
  expect(attempt.reset()).toBe(false);
});
