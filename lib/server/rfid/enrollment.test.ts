import { beforeEach, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
vi.mock("server-only", () => ({}));
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>>(), sequence: 0, failCleanup: false, tail: Promise.resolve() }));
vi.mock("./auth", () => ({ requireAdmin: async () => "admin", assertDeviceCurrent: (_: unknown, device: { enabled: boolean }) => {
  if (!device?.enabled) throw new Error("unauthorized");
} }));
vi.mock("../firebase-admin", () => {
  const ref = (path: string) => ({ path, id: path.split("/").at(-1) });
  const querySnapshot = (path: string, field?: string, value?: unknown) => {
    const docs = [...store.data.entries()].filter(([key, data]) => key.startsWith(`${path}/`) && (!field || data[field] === value))
      .map(([key, data]) => ({ ...ref(key), ref: ref(key), data: () => data }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const collection = (path: string, field?: string, value?: unknown) => ({
    path, field, value,
    limit: () => collection(path, field, value),
    orderBy: () => collection(path, field, value),
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
import { startAssignment, captureAssignment, pollCommand, cancelAssignment, removeCard, ASSIGNMENT_TIMEOUT_MS } from "./enrollment";
import { scanAttendance } from "../attendance";
import { GET as adminStatus } from "@/app/api/rfid/admin/assignments/route";
const now = 1_800_000_000_000;
const stamp = (ms: number) => Timestamp.fromMillis(ms);
const request = new Request("https://example.com");
const person = (id = "p1") => store.data.get(`persons/${id}`)!;
const device = () => store.data.get("rfidDevices/entrance-01")!;
const audits = () => [...store.data.keys()].filter((p) => p.startsWith("rfidCardChanges/"));
const attendance = () => [...store.data.keys()].filter((p) => p.startsWith("attendanceLogs/"));
const begin = (id = "p1", operation = "assign", previous: string | null = null) => startAssignment("admin", id, operation, previous);
const capture = (assignmentId: string, uid: unknown = "09:70:65:20", eventId = "enroll-event-000001", requestedAt = Date.now()) =>
  captureAssignment(request, { mode: "enrollment", deviceId: "entrance-01", assignmentId, uid, eventId, requestedAt });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); store.data.clear(); store.sequence = 0; store.tail = Promise.resolve();
  for (const id of ["p1", "p2"]) {
    store.data.set(`persons/${id}`, { type: id === "p1" ? "guest" : "member", status: "active", membershipExpiry: null,
      rfidTagId: null, visitCount: 4, lastVisitAt: stamp(now - 1_000) });
    store.data.set(`attendanceState/${id}`, { openLogId: null, lastAction: null, lastAcceptedScanAt: null });
  }
  store.data.set("rfidDevices/entrance-01", { label: "Entrance", enabled: true, lastSeenAt: stamp(now), activeAssignmentId: null });
});
it("shares the active enrollment across profiles without returning device secrets", async () => {
  device().credentialHash = "private-verifier";
  person().name = "Guest One";
  const id = (await begin()).assignmentId;
  const response = await adminStatus(new Request("https://example.com/api/rfid/admin/assignments?personId=p2"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const data = await response.json();
  expect(data).toMatchObject({ uid: null, scanner: { online: true }, active: { id, personId: "p1", personName: "Guest One", status: "pending" } });
  expect(JSON.stringify(data)).not.toContain("private-verifier");
  expect(JSON.stringify(data)).not.toContain("credentialHash");
  expect(attendance()).toHaveLength(0);
});
it("admin status authoritatively expires an offline scanner reservation without altering the card", async () => {
  const id = (await begin()).assignmentId!;
  person().rfidTagId = "09:70:65:20";
  vi.setSystemTime(now + ASSIGNMENT_TIMEOUT_MS + 1);
  device().enabled = false;
  const response = await adminStatus(new Request("https://example.com/api/rfid/admin/assignments?personId=p1"));
  expect(await response.json()).toMatchObject({ uid: "09:70:65:20", scanner: { online: false }, active: null, latest: { id, status: "expired" } });
  expect(device().activeAssignmentId).toBeNull();
  expect(store.data.get(`rfidAssignments/${id}`)?.status).toBe("expired");
  expect(person().visitCount).toBe(4);
});
it("serializes overlapping tabs and claims a guest card atomically without attendance", async () => {
  const attempts = await Promise.allSettled([begin(), begin("p2")]);
  expect(attempts[0].status).toBe("fulfilled");
  expect(attempts[1]).toMatchObject({ status: "rejected", reason: { code: "enrollment-active" } });
  const id = (attempts[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof begin>>>).value.assignmentId!;
  expect((await pollCommand(request))).toMatchObject({ mode: "enrollment", assignmentId: id });
  expect(await capture(id)).toMatchObject({ resultCode: "rfid-assigned" });
  expect(person().rfidTagId).toBe("09:70:65:20");
  expect(store.data.get("rfidCards/09:70:65:20")?.personId).toBe("p1");
  expect(person().visitCount).toBe(4); expect(attendance()).toHaveLength(0); expect(audits()).toHaveLength(1);
  expect(device().activeAssignmentId).toBeNull();
  vi.setSystemTime(now + 60_000);
  expect(await pollCommand(request)).toMatchObject({ mode: "attendance" });
  expect(await capture(id, "69:1A:71:9E", "enroll-event-000002")).toMatchObject({ resultCode: "assignment-completed" });
  expect(person().rfidTagId).toBe("09:70:65:20");
});
it("keeps invalid captures pending but ends enrollment when the card belongs to another profile", async () => {
  store.data.set("rfidCards/09:70:65:20", { personId: "p2" });
  person("p2").rfidTagId = "09:70:65:20";
  const id = (await begin()).assignmentId!;
  expect((await capture(id, "bad"))).toMatchObject({ resultCode: "invalid-uid" });
  expect(store.data.get(`rfidAssignments/${id}`)).toMatchObject({ status: "pending", lastErrorCode: "invalid-uid" });
  expect((await capture(id, "09:70:65:20", "enroll-event-000002"))).toMatchObject({ resultCode: "card-owned" });
  expect(person().rfidTagId).toBeNull(); expect(device().activeAssignmentId).toBeNull();
  expect(store.data.get(`rfidAssignments/${id}`)).toMatchObject({ status: "cancelled", lastErrorCode: "card-owned" });
  vi.setSystemTime(now + 60_000);
  expect(await pollCommand(request)).toMatchObject({ mode: "attendance" });
  const status = await adminStatus(new Request("https://example.com/api/rfid/admin/assignments?personId=p1"));
  expect(await status.json()).toMatchObject({ active: null, latest: { id, status: "cancelled", lastErrorCode: "card-owned" } });
  expect(await capture(id, "69:1A:71:9E", "enroll-event-000003")).toMatchObject({ resultCode: "assignment-cancelled" });
  expect(person().rfidTagId).toBeNull();
  // Retrying a lost response must recover the original rejection without rearming.
  expect(await capture(id, "09:70:65:20", "enroll-event-000002", now)).toMatchObject({ resultCode: "card-owned" });
  expect(device().activeAssignmentId).toBeNull();
  const next = (await begin()).assignmentId!;
  expect(await capture(id, "09:70:65:20", "enroll-event-000002", now)).toMatchObject({ resultCode: "card-owned" });
  expect(device().activeAssignmentId).toBe(next);
  expect(await capture(next, "69:1A:71:9E", "enroll-event-000004")).toMatchObject({ resultCode: "rfid-assigned" });
  expect(await pollCommand(request)).toMatchObject({ mode: "attendance" });
  expect(person("p2").rfidTagId).toBe("09:70:65:20");
});
it("recovers lost committed results after the command deadline and rejects event reuse", async () => {
  const id = (await begin()).assignmentId!;
  const result = await capture(id);
  vi.setSystemTime(now + ASSIGNMENT_TIMEOUT_MS + 1);
  expect(await capture(id, "09:70:65:20", "enroll-event-000001", now)).toEqual(result);
  await expect(capture(id, "69:1A:71:9E", "enroll-event-000001", now)).rejects.toMatchObject({ code: "event-id-conflict" });
  vi.setSystemTime(now + 600_001);
  await expect(capture(id, "09:70:65:20", "enroll-event-000001", now)).rejects.toMatchObject({ code: "retry-expired" });
  expect(audits()).toHaveLength(1);
});
it("same-owner reassignment succeeds without a second audit and requires explicit replacement", async () => {
  await capture((await begin()).assignmentId!);
  const id = (await begin("p1", "assign", "09:70:65:20")).assignmentId!;
  expect(await capture(id, "69:1A:71:9E", "enroll-event-000002")).toMatchObject({ resultCode: "replace-required" });
  expect(await capture(id, "09:70:65:20", "enroll-event-000003")).toMatchObject({ resultCode: "rfid-assigned" });
  expect(audits()).toHaveLength(1);
});
it("replacement preserves the original on conflict and releases it only on success", async () => {
  await capture((await begin()).assignmentId!);
  const id = (await begin("p1", "replace", "09:70:65:20")).assignmentId!;
  store.data.set("rfidCards/69:1A:71:9E", { personId: "p2" });
  expect(await capture(id, "69:1A:71:9E", "enroll-event-000002")).toMatchObject({ resultCode: "card-owned" });
  expect(person().rfidTagId).toBe("09:70:65:20"); expect(store.data.has("rfidCards/09:70:65:20")).toBe(true);
  expect(device().activeAssignmentId).toBeNull();
  store.data.delete("rfidCards/69:1A:71:9E");
  const next = (await begin("p1", "replace", "09:70:65:20")).assignmentId!;
  expect(await capture(next, "69:1A:71:9E", "enroll-event-000003")).toMatchObject({ resultCode: "rfid-assigned" });
  expect(store.data.has("rfidCards/09:70:65:20")).toBe(false); expect(person().rfidTagId).toBe("69:1A:71:9E");
  expect((await scanAttendance({ source: "rfid", uid: "09:70:65:20", eventId: "old-card-scan-0001",
    requestedAt: Date.now(), request })).resultCode).toBe("unknown-card");
  expect((await scanAttendance({ source: "rfid", uid: "69:1A:71:9E", eventId: "new-card-scan-0001",
    requestedAt: Date.now(), request })).action).toBe("checked-in");
});
it("removal defeats stale replacement and preserves attendance counters", async () => {
  await capture((await begin()).assignmentId!);
  const id = (await begin("p1", "replace", "09:70:65:20")).assignmentId!;
  await removeCard("admin", "p1", "09:70:65:20");
  expect(await capture(id, "69:1A:71:9E", "enroll-event-000002")).toMatchObject({ resultCode: "binding-changed" });
  expect(person().rfidTagId).toBeNull(); expect(person().visitCount).toBe(4);
  expect(audits()).toHaveLength(2);
  await expect(removeCard("admin", "p2", "09:70:65:20")).resolves.toMatchObject({ resultCode: "card-removed" });
});
it.each(["cancel", "expire", "delete"])("rejects late enrollment for %s and releases only its own reservation", async (mode) => {
  const id = (await begin()).assignmentId!;
  if (mode === "cancel") await cancelAssignment(id);
  if (mode === "expire") vi.setSystemTime(now + ASSIGNMENT_TIMEOUT_MS);
  if (mode === "delete") person().deletingAt = stamp(now);
  expect((await capture(id)).resultCode).toBe(mode === "cancel" ? "assignment-cancelled" : mode === "expire" ? "assignment-expired" : "person-unavailable");
  expect(person().rfidTagId).toBeNull(); expect(device().activeAssignmentId).toBeNull(); expect(attendance()).toHaveLength(0);
  device().lastSeenAt = stamp(Date.now());
  const newer = (await begin("p2")).assignmentId!;
  await capture(id, "09:70:65:20", "enroll-event-000002");
  expect(device().activeAssignmentId).toBe(newer);
});
it("throttles heartbeat writes, expires commands on polling, and returns sanitized idle state", async () => {
  const id = (await begin()).assignmentId!;
  vi.setSystemTime(now + 59_999); await pollCommand(request);
  expect(device().lastSeenAt).toEqual(stamp(now));
  vi.setSystemTime(now + 60_000); await pollCommand(request);
  expect(device().lastSeenAt).toEqual(stamp(now + 60_000));
  vi.setSystemTime(now + 120_000);
  expect(await pollCommand(request)).toEqual({ mode: "attendance", pollAfterMs: 15_000 });
  expect(store.data.get(`rfidAssignments/${id}`)?.status).toBe("expired");
  expect(store.data.get("rfidDeviceStatus/entrance-01")).not.toHaveProperty("credentialHash");
});
it("rejects attendance before the next poll, then enforces expiry without background cleanup", async () => {
  await capture((await begin()).assignmentId!);
  const id = (await begin("p2")).assignmentId!;
  const tap = () => scanAttendance({ source: "rfid", uid: "09:70:65:20", eventId: `attendance-${Date.now()}`, requestedAt: Date.now(), request });
  expect(await tap()).toMatchObject({ resultCode: "enrollment-active" }); expect(attendance()).toHaveLength(0);
  vi.setSystemTime(now + ASSIGNMENT_TIMEOUT_MS);
  expect(await tap()).toMatchObject({ resultCode: "checked-in" });
  expect(store.data.get(`rfidAssignments/${id}`)?.status).toBe("expired"); expect(device().activeAssignmentId).toBeNull();
});
it("fails closed for offline/disabled scanners, deleted targets, stale bindings, and wrong command identities", async () => {
  device().lastSeenAt = stamp(now - 180_000);
  await expect(begin()).rejects.toMatchObject({ code: "scanner-offline" });
  device().lastSeenAt = stamp(now); person().deletingAt = stamp(now);
  await expect(begin()).rejects.toMatchObject({ code: "person-unavailable" });
  delete person().deletingAt;
  await expect(begin("p1", "replace", "09:70:65:20")).rejects.toMatchObject({ code: "binding-changed" });
  const id = (await begin()).assignmentId!;
  await expect(capture("missing")).rejects.toMatchObject({ code: "command-mismatch" });
  device().enabled = false;
  await expect(capture(id)).rejects.toThrow("unauthorized");
  await expect(pollCommand(request)).rejects.toThrow("unauthorized");
});

it("expires an old reservation when another tab starts and never lets the old capture claim a card", async () => {
  const old = (await begin()).assignmentId!;
  vi.setSystemTime(now + ASSIGNMENT_TIMEOUT_MS);
  const next = (await begin("p2")).assignmentId!;
  expect(store.data.get(`rfidAssignments/${old}`)?.status).toBe("expired");
  expect(await capture(old)).toMatchObject({ resultCode: "assignment-expired" });
  expect(device().activeAssignmentId).toBe(next); expect(person().rfidTagId).toBeNull();
});

it("polling cancels enrollment for a missing target and does not deliver its identity", async () => {
  const id = (await begin()).assignmentId!;
  store.data.delete("persons/p1");
  expect(await pollCommand(request)).toEqual({ mode: "attendance", pollAfterMs: 15_000 });
  expect(store.data.get(`rfidAssignments/${id}`)).toMatchObject({ status: "cancelled", lastErrorCode: "person-unavailable" });
  expect(device().activeAssignmentId).toBeNull();
});
