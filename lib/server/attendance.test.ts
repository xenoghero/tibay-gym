import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
vi.mock("server-only", () => ({}));
vi.mock("./rfid/rate-limit", () => ({ throttle: vi.fn() }));
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), sequence: 0, failCleanup: false, tail: Promise.resolve() }));
vi.mock("./rfid/auth", () => ({ assertDeviceCurrent: (_: unknown, device: { enabled: boolean }) => {
  if (!device?.enabled) throw new Error("unauthorized");
} }));
vi.mock("./firebase-admin", () => {
  const ref = (path: string) => ({ path, id: path.split("/").at(-1), get: async () => ({ data: () => store.data.get(path) }) });
  const querySnapshot = (path: string, field?: string, value?: unknown) => {
    const docs = [...store.data.entries()].filter(([key, data]) => key.startsWith(`${path}/`) && (!field || data[field] === value))
      .map(([key, data]) => ({ ...ref(key), ref: ref(key), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const collection = (path: string, field?: string, value?: unknown) => ({
    path, field, value,
    limit: () => collection(path, field, value),
    get: async () => {
      if (store.failCleanup && path === "weightEntries") throw new Error("cleanup unavailable");
      return querySnapshot(path, field, value);
    }, doc: () => ref(`${path}/log-${++store.sequence}`),
    where: (f: string, _op: string, v: unknown) => collection(path, f, v),
  });
  return { adminDb: () => ({ doc: ref, collection,
    batch: () => {
      const paths: string[] = [];
      return { delete: (r: { path: string }) => paths.push(r.path), commit: async () => { paths.forEach((path) => store.data.delete(path)); } };
    },
    runTransaction: (callback: (tx: unknown) => Promise<unknown>) => {
      const run = store.tail.then(async () => {
        let writing = false;
        const writes: Array<() => void> = [];
        const tx = {
          get: async (r: { path: string; field?: string; value?: unknown; where?: unknown }) => {
            if (writing) throw new Error("read after write");
            if (r.where) {
              const docs = [...store.data.entries()].filter(([path, data]) => path.startsWith(`${r.path}/`) && (!r.field || data[r.field] === r.value))
                .map(([path, data]) => ({ ...ref(path), ref: ref(path), data: () => data }));
              return { docs, size: docs.length, empty: docs.length === 0 };
            }
            return { data: () => store.data.get(r.path) };
          },
          delete: (r: { path: string }) => { writing = true; writes.push(() => store.data.delete(r.path)); },
          set: (r: { path: string }, data: Record<string, unknown>) => {
            writing = true; writes.push(() => store.data.set(r.path, data));
          },
          update: (r: { path: string }, data: Record<string, unknown>) => {
            writing = true; writes.push(() => {
              const previous = store.data.get(r.path)!;
              const next = { ...previous, ...data };
              if (typeof data.visitCount === "object") next.visitCount = Number(previous.visitCount) + 1;
              store.data.set(r.path, next);
            });
          },
        };
        const result = await callback(tx);
        writes.forEach((write) => write());
        return result;
      });
      store.tail = run.then(() => undefined, () => undefined);
      return run;
    },
  }) };
});
import { scanAttendance, closeGuardedStaleSession, STALE_SESSION_MS } from "./attendance";
import { fingerprint, makeReceipt, readReceipt, ENROLLMENT_RECOVERY_MS } from "./rfid/receipts";
import { receiptId } from "./rfid/validation";
import { adminDb } from "./firebase-admin";
const now = 1_800_000_000_000;
const stamp = (ms: number) => Timestamp.fromMillis(ms);
const qr = (event = "event-000000000001") => ({ source: "qr" as const, personId: "p1", eventId: event, requestedAt: Date.now() });
const rfid = (event = "event-000000000002") => ({ source: "rfid" as const, uid: "09:70:65:20", eventId: event,
  requestedAt: Date.now(), request: new Request("https://example.com") });
const logs = () => [...store.data.entries()].filter(([path]) => path.startsWith("attendanceLogs/"));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); store.data.clear(); store.sequence = 0; store.failCleanup = false; store.tail = Promise.resolve();
  store.data.set("persons/p1", { type: "member", status: "active", membershipExpiry: stamp(now + 100_000),
    rfidTagId: "09:70:65:20", visitCount: 0, lastVisitAt: null });
  store.data.set("rfidDevices/entrance-01", { enabled: true, activeAssignmentId: null });
  store.data.set("rfidCards/09:70:65:20", { personId: "p1" });
  store.data.set("attendanceState/p1", { openLogId: null, lastAction: null, lastAcceptedScanAt: null });
});
it("serializes simultaneous mixed-channel events and recovers lost responses without reversing attendance", async () => {
  const request = qr();
  const [a, b] = await Promise.all([scanAttendance(request), scanAttendance(rfid())]);
  expect(a.action).toBe("checked-in"); expect(b.logId).toBe(a.logId);
  expect(logs()).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
  vi.setSystemTime(now + 4_000);
  expect(await scanAttendance(request)).toEqual(a);
  vi.setSystemTime(now + 30_000);
  const close = await scanAttendance(rfid("event-000000000003"));
  expect(close.action).toBe("checked-out");
  expect(logs()[0][1]).toMatchObject({ source: "qr", closedReason: "implicit" });
  expect(store.data.get("persons/p1")?.visitCount).toBe(1);
});
it("QR closes an RFID opening while preserving its source", async () => {
  await scanAttendance(rfid()); vi.setSystemTime(now + 30_000);
  expect((await scanAttendance(qr())).action).toBe("checked-out");
  expect(logs()[0][1].source).toBe("rfid");
});
it("concurrent first QR/RFID scans initialize one guard and one visit for a new profile", async () => {
  store.data.delete("attendanceState/p1");
  const [qrResult, rfidResult] = await Promise.all([scanAttendance(qr()), scanAttendance(rfid())]);
  expect(qrResult.action).toBe("checked-in");
  expect(rfidResult.logId).toBe(qrResult.logId);
  expect(logs()).toHaveLength(1);
  expect(store.data.get("persons/p1")?.visitCount).toBe(1);
  expect(store.data.get("attendanceState/p1")?.openLogId).toBe(qrResult.logId);
});
it("does not initialize a missing guard when a profile already records a last visit", async () => {
  store.data.delete("attendanceState/p1");
  store.data.get("persons/p1")!.lastVisitAt = stamp(now - 60000);
  const before = new Map(store.data);
  await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "attendance-not-initialized" });
  expect(store.data).toEqual(before);
});
it("rejects new QR/RFID changes throughout the cooldown without writes, then admits at the boundary", async () => {
  const original = qr();
  const opened = await scanAttendance(original);
  vi.setSystemTime(now + 4000);
  const before = new Map(store.data);
  for (const request of [qr("spam-qr-event-00001"), rfid("spam-rfid-event-001"),
    { ...qr("spam-checkout-00001"), intent: "checkout" as const, expectedLogId: opened.logId! }]) {
    await expect(scanAttendance(request)).rejects.toMatchObject({ status: 429, code: "attendance-cooldown", retryAfterSeconds: 26 });
    expect(store.data).toEqual(before);
  }
  expect(await scanAttendance(original)).toEqual(opened);
  vi.setSystemTime(now + 30_000);
  expect((await scanAttendance(qr("boundary-event-0001"))).action).toBe("checked-out");
});
it.each([false, true])("rejects expired RFID before session cleanup (stale=%s), preserving counters and guard", async (stale) => {
  await scanAttendance(qr());
  vi.setSystemTime(now + (stale ? STALE_SESSION_MS : 4_000));
  store.data.get("persons/p1")!.membershipExpiry = stamp(Date.now());
  const before = new Map(store.data);
  const result = await scanAttendance(rfid());
  expect(result.resultCode).toBe("expired-member");
  for (const path of ["persons/p1", "attendanceState/p1", logs()[0][0]]) expect(store.data.get(path)).toEqual(before.get(path));
  const tap = [...store.data.entries()].find(([p]) => p.startsWith("rfidTapEvents/"))![1];
  expect(tap).toMatchObject({ attendanceLogId: null, effectiveStatusAtTap: "expired" });
  expect(tap.retainUntil).toEqual(stamp(Date.now() + 90 * 86_400_000));
  expect(await scanAttendance(rfid())).toEqual(result);
});
it("accepts assigned guests and retains QR's expired-member policy", async () => {
  store.data.get("persons/p1")!.type = "guest";
  store.data.get("persons/p1")!.status = null;
  expect((await scanAttendance(rfid())).action).toBe("checked-in");
  store.data.get("persons/p1")!.type = "member";
  store.data.get("persons/p1")!.status = "expired";
  vi.setSystemTime(now + 30_000);
  expect((await scanAttendance(qr())).action).toBe("checked-out");
});
it("uses the server-time expiry boundary and renewal without changing card ownership", async () => {
  const expiry = now + 10_000;
  store.data.get("persons/p1")!.membershipExpiry = stamp(expiry);
  vi.setSystemTime(expiry - 1);
  expect((await scanAttendance(rfid("before-expiry-0001"))).action).toBe("checked-in");
  vi.setSystemTime(expiry);
  const before = new Map(store.data);
  expect((await scanAttendance(rfid("at-expiry-000001"))).resultCode).toBe("expired-member");
  expect(store.data.get("persons/p1")).toEqual(before.get("persons/p1"));
  expect(store.data.get("attendanceState/p1")).toEqual(before.get("attendanceState/p1"));
  expect(logs()[0][1]).toEqual(before.get(logs()[0][0]));
  store.data.get("persons/p1")!.membershipExpiry = stamp(expiry + 100_000);
  vi.setSystemTime(expiry + 30_000);
  expect((await scanAttendance(rfid("after-renewal-001"))).action).toBe("checked-out");
  expect(store.data.get("rfidCards/09:70:65:20")?.personId).toBe("p1");
});
it("rejects stored-active past expiry and a guest converted into an expired member", async () => {
  store.data.get("persons/p1")!.membershipExpiry = stamp(now - 1);
  expect((await scanAttendance(rfid("past-expiry-0001"))).resultCode).toBe("expired-member");
  store.data.get("persons/p1")!.type = "guest";
  expect((await scanAttendance(rfid("guest-scan-000001"))).action).toBe("checked-in");
  vi.setSystemTime(now + 30_000);
  store.data.get("persons/p1")!.type = "member";
  expect((await scanAttendance(rfid("converted-expired"))).resultCode).toBe("expired-member");
  expect(logs()).toHaveLength(1);
  expect(store.data.get("persons/p1")?.visitCount).toBe(1);
  expect((await scanAttendance(qr("qr-fallback-00001"))).action).toBe("checked-out");
});
it("auto-closes stale visits and atomically opens one new visit", async () => {
  await scanAttendance(qr()); vi.setSystemTime(now + STALE_SESSION_MS);
  const next = await scanAttendance(qr("event-000000000004"));
  expect(next.action).toBe("checked-in"); expect(logs()).toHaveLength(2);
  expect(logs()[0][1].closedReason).toBe("auto");
  expect(store.data.get("persons/p1")?.visitCount).toBe(2);
  expect(await closeGuardedStaleSession("p1", logs()[0][0].split("/")[1])).toBe(false);
});
it("conditionally cleans up only the expected still-open stale session", async () => {
  const opened = await scanAttendance(qr()); vi.setSystemTime(now + STALE_SESSION_MS);
  expect(await closeGuardedStaleSession("p1", opened.logId!)).toBe(true);
  expect(await closeGuardedStaleSession("p1", opened.logId!)).toBe(false);
  expect(logs()[0][1].closedReason).toBe("auto");
});
it("rejects conflicting IDs and expired replay even if receipt cleanup already ran", async () => {
  const request = qr(); await scanAttendance(request);
  await expect(scanAttendance({ ...request, personId: "p2" })).rejects.toMatchObject({ code: "event-id-conflict" });
  vi.setSystemTime(now + 30_001);
  await expect(scanAttendance(request)).rejects.toMatchObject({ code: "retry-expired" });
  for (const path of store.data.keys()) if (path.startsWith("scanResults/")) store.data.delete(path);
  await expect(scanAttendance(request)).rejects.toMatchObject({ code: "retry-expired" });
  expect(logs()).toHaveLength(1);
});
it.each(["unknown", "reserved", "deleting"])("persists bounded rejection receipts for %s", async (kind) => {
  if (kind === "unknown") store.data.delete("rfidCards/09:70:65:20");
  if (kind === "reserved") {
    store.data.get("rfidDevices/entrance-01")!.activeAssignmentId = "assignment1";
    store.data.set("rfidAssignments/assignment1", { deviceId: "entrance-01", status: "pending", expiresAt: stamp(now + 120_000) });
  }
  if (kind === "deleting") store.data.get("persons/p1")!.deletingAt = stamp(now);
  expect((await scanAttendance(rfid())).action).toBeNull(); expect(logs()).toHaveLength(0);
});
it("fails closed for unreconciled guards, stale guard references, and disabled devices", async () => {
  store.data.delete("attendanceState/p1");
  store.data.get("persons/p1")!.visitCount = 1;
  await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "attendance-not-initialized" });
  store.data.set("attendanceState/p1", { openLogId: "missing" });
  await expect(scanAttendance(qr())).rejects.toMatchObject({ code: "attendance-state-conflict" });
  store.data.get("rfidDevices/entrance-01")!.enabled = false;
  await expect(scanAttendance(rfid())).rejects.toThrow("unauthorized");
  expect(logs()).toHaveLength(0);
});
it("recovers committed enrollment after command expiry using the separate ten-minute window", async () => {
  const identity = { origin: "device:entrance-01", eventId: "enroll-0000000001", requestedAt: now };
  const digest = fingerprint(["enrollment", identity.requestedAt]);
  const result = makeReceipt(identity, digest, now, { resultCode: "assigned", action: null, logId: null, personId: "p1", assignmentId: "a1" });
  store.data.set(`scanResults/${receiptId(identity.origin, identity.eventId)}`, { ...result });
  vi.setSystemTime(now + 120_001);
  const recovered = await adminDb().runTransaction((tx) => readReceipt(tx, adminDb(), identity, digest, Date.now(), ENROLLMENT_RECOVERY_MS));
  expect(recovered.existing).toEqual(result);
  vi.setSystemTime(now + 600_001);
  await expect(adminDb().runTransaction((tx) => readReceipt(tx, adminDb(), identity, digest, Date.now(), ENROLLMENT_RECOVERY_MS))).rejects.toMatchObject({ code: "retry-expired" });
});

import { forceClose, repairVisits, deleteProfile } from "./attendance-admin";
it("manual close clears the guard and cannot overwrite a scan's newer close", async () => {
  const opened = await scanAttendance(qr());
  await forceClose(opened.logId!);
  expect(store.data.get(`attendanceLogs/${opened.logId}`)?.closedReason).toBe("manual");
  expect(store.data.get("attendanceState/p1")?.openLogId).toBeNull();
  await scanAttendance(qr("event-000000000012"));
  await forceClose(opened.logId!);
  expect(logs()).toHaveLength(2);
  expect(store.data.get("attendanceState/p1")?.openLogId).not.toBeNull();
});
it("visit deletion clears open/rescan references and repairs counters under the shared guard", async () => {
  const opened = await scanAttendance(qr());
  const result = await repairVisits("p1", opened.logId!);
  expect(result).toMatchObject({ visitCount: 0, lastVisitAtMs: null });
  expect(store.data.get("attendanceState/p1")).toMatchObject({ openLogId: null, lastLogId: null, lastAction: null });
  expect(logs()).toHaveLength(0);
  expect((await scanAttendance(qr("event-000000000013"))).action).toBe("checked-in");
});
it("isolates new guest attendance and address atomically and recovers an uncertain result", async () => {
  store.data.delete("persons/p1"); store.data.delete("attendanceState/p1");
  const request = { ...qr(), guest: { name: "Guest", phone: "123", address: "Private" } };
  const result = await scanAttendance(request);
  expect(await scanAttendance(request)).toEqual(result);
  expect(logs()).toHaveLength(0);
  expect(store.data.get("unverifiedPersons/p1")).toMatchObject({ type: "guest", visitCount: 1, address: "Private" });
  expect(store.data.has("persons/p1")).toBe(false);
  expect(store.data.has("profileDetails/p1")).toBe(false);
  expect(store.data.has("smsContacts/p1")).toBe(false);
  expect([...store.data.keys()].filter(path => path.startsWith("unverifiedAttendanceLogs/"))).toHaveLength(1);
});
it("frozen profiles reject QR and admin repair without attendance changes", async () => {
  store.data.get("persons/p1")!.deletingAt = stamp(now);
  expect((await scanAttendance(qr())).resultCode).toBe("person-unavailable");
  await expect(repairVisits("p1")).rejects.toThrow("person-unavailable");
  expect(logs()).toHaveLength(0);
});

it("profile deletion freezes before cleanup, cancels enrollment, releases cards, and resumes after failure", async () => {
  await scanAttendance(qr());
  store.data.set("rfidAssignments/a1", { personId: "p1", status: "pending" });
  store.data.get("rfidDevices/entrance-01")!.activeAssignmentId = "a1";
  for (const name of ["weightEntries", "statusChanges", "rfidCardChanges", "rfidTapEvents"]) store.data.set(`${name}/child`, { personId: "p1" });
  store.data.set("profileDetails/p1", { address: "Private" });
  store.data.set("smsContacts/p1", { phone: "+639171234567", permission: true });
  store.data.set("smsMessages/private-message", { personId: "p1", destination: "+639171234567", text: "Private" });
  store.data.set("smsAttempts/private-attempt", { personId: "p1", messageId: "private-message" });
  store.failCleanup = true;
  await expect(deleteProfile("p1")).rejects.toThrow("cleanup unavailable");
  expect(store.data.get("persons/p1")?.deletingAt).toBeTruthy();
  expect(store.data.get("rfidAssignments/a1")?.status).toBe("cancelled");
  expect(store.data.get("rfidDevices/entrance-01")?.activeAssignmentId).toBeNull();
  expect(store.data.has("rfidCards/09:70:65:20")).toBe(false);
  expect((await scanAttendance(qr("event-000000000014"))).personId).toBeNull();
  store.failCleanup = false;
  await deleteProfile("p1");
  await deleteProfile("p1");
  expect(store.data.has("persons/p1")).toBe(false);
  expect(store.data.has("attendanceState/p1")).toBe(false);
  expect(store.data.has("profileDetails/p1")).toBe(false);
  expect([...store.data.entries()].filter(([path, data]) => data.personId === "p1" && !path.startsWith("auditEvents/"))).toHaveLength(0);
  expect([...store.data.entries()].filter(([path, data]) => data.personId === "p1" && path.startsWith("auditEvents/"))).toHaveLength(2);
});

it("explicit checkout respects the cooldown and recovers without reopening attendance", async () => {
  const opened = await scanAttendance(qr());
  vi.setSystemTime(now + 30_000);
  const request = { ...qr("checkout-event-000001"), intent: "checkout" as const, expectedLogId: opened.logId! };
  const closed = await scanAttendance(request);
  expect(closed.action).toBe("checked-out");
  expect(await scanAttendance(request)).toEqual(closed);
  expect(logs()).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
  expect(store.data.get("attendanceState/p1")?.openLogId).toBeNull();
});
it("checkout-only without an open session never creates a visit, even during a rescan guard", async () => {
  const request = { ...qr(), intent: "checkout" as const, expectedLogId: "old-log" };
  expect((await scanAttendance(request)).resultCode).toBe("no-open-session");
  expect(logs()).toHaveLength(0); expect(store.data.get("persons/p1")?.visitCount).toBe(0);
});
it("stale checkout closes the expected session without starting another visit", async () => {
  const opened = await scanAttendance(qr()); vi.setSystemTime(now + STALE_SESSION_MS);
  expect((await scanAttendance({ ...qr("checkout-event-000002"), intent: "checkout", expectedLogId: opened.logId! })).action).toBe("checked-out");
  expect(logs()).toHaveLength(1); expect(logs()[0][1].closedReason).toBe("auto");
  expect(store.data.get("persons/p1")?.visitCount).toBe(1);
});
it("checkout session mismatch or an old retry cannot close a newer RFID session", async () => {
  const opened = await scanAttendance(qr());
  vi.setSystemTime(now + 30_000);
  const request = { ...qr("checkout-event-000003"), intent: "checkout" as const, expectedLogId: opened.logId! };
  const closed = await scanAttendance(request);
  vi.setSystemTime(now + 60_000);
  const newer = await scanAttendance(rfid());
  expect(await scanAttendance(request)).toEqual(closed);
  const mismatch = await scanAttendance({ ...qr("checkout-event-000004"), intent: "checkout", expectedLogId: opened.logId! });
  expect(mismatch.resultCode).toBe("checkout-session-changed");
  expect(store.data.get("attendanceState/p1")?.openLogId).toBe(newer.logId);
  expect(store.data.get(`attendanceLogs/${newer.logId}`)?.checkOutAt).toBeNull();
});
it("checkout binds expected session and intent into the existing receipt identity", async () => {
  const opened = await scanAttendance(qr());
  vi.setSystemTime(now + 30_000);
  const request = { ...qr("checkout-event-000005"), intent: "checkout" as const, expectedLogId: opened.logId! };
  await scanAttendance(request);
  await expect(scanAttendance({ ...request, expectedLogId: "another-log" })).rejects.toMatchObject({ code: "event-id-conflict" });
  await expect(scanAttendance(qr(request.eventId))).rejects.toMatchObject({ code: "event-id-conflict" });
  vi.setSystemTime(now + 60_001);
  await expect(scanAttendance(request)).rejects.toMatchObject({ code: "retry-expired" });
  expect(logs()).toHaveLength(1);
});
it("simultaneous checkout-only requests close at most once without creating a visit", async () => {
  const opened = await scanAttendance(qr());
  vi.setSystemTime(now + 30_000);
  const results = await Promise.all(["checkout-event-000006", "checkout-event-000007"].map(event =>
    scanAttendance({ ...qr(event), intent: "checkout", expectedLogId: opened.logId! })));
  expect(results.map(result => result.resultCode).sort()).toEqual(["checked-out", "no-open-session"]);
  expect(logs()).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
});

import { POST as qrScanRoute } from "@/app/api/attendance/scan/route";
it("route retries without device position return the persisted receipt without another toggle", async () => {
  const identity = { personId: "p1", eventId: "attendance-retry-0001", requestedAt: now };
  const send = () => qrScanRoute(new Request("https://reshape.test/api/attendance/scan", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(identity),
  }));
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const first = await send();
    expect(first.status).toBe(200); const original = await first.json();
    vi.setSystemTime(now + 4000);
    expect(await (await send()).json()).toEqual(original);
    expect(logs()).toHaveLength(1); expect(store.data.get("persons/p1")?.visitCount).toBe(1);
    const stored = JSON.stringify([...store.data.values()]);
    for (const field of ["latitude", "longitude", "accuracyMeters", "capturedAtMs", "location"]) expect(stored).not.toContain(`"${field}":`);
    expect(store.data.get("attendanceState/p1")?.openLogId).toBe(logs()[0][0].split("/")[1]);
  } finally { info.mockRestore(); }
});
