import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ verify: vi.fn(), get: vi.fn(), throttle: vi.fn() }));
vi.mock("@/lib/server/firebase-admin", () => ({
  adminAuth: () => ({ verifyIdToken: mocks.verify }),
  adminDb: () => ({ doc: () => ({ get: mocks.get }) }),
}));
vi.mock("./rate-limit", () => ({ throttle: mocks.throttle }));

import { requireAdmin, requireDevice, assertDeviceCurrent } from "./auth";
import { readBody, handleApi } from "./http";
import { assertCommandOwnership, assertPersonAvailable, canonicalUid, credentialHash,
  receiptId, validateCapture } from "./validation";
import type { RfidAssignment } from "@/lib/rfid/models";
import { POST } from "@/app/api/rfid/device/identity/route";
import { POST as start, PATCH as cancel } from "@/app/api/rfid/admin/assignments/route";
import { POST as remove } from "@/app/api/rfid/admin/cards/route";
import { GET as commands } from "@/app/api/rfid/device/commands/route";
import { POST as capture } from "@/app/api/rfid/device/capture/route";

const secret = "a".repeat(43);
const request = (token = secret, deviceId = "entrance-01") => new Request("https://reshape.test/api", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "x-rfid-device-id": deviceId },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "allowed-admin");
  mocks.throttle.mockResolvedValue(undefined);
});

describe("admin identity", () => {
  it.each([start, cancel, remove])("denies non-admin enrollment mutations before reading their bodies", async (handler) => {
    mocks.verify.mockResolvedValue({ uid: "someone-else" });
    const response = await handler(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "admin-required" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("verifies revocation and the explicit UID against the rules identity", async () => {
    mocks.verify.mockResolvedValue({ uid: "allowed-admin" });
    mocks.get.mockResolvedValue({ data: () => ({ uid: "allowed-admin" }) });
    expect(await requireAdmin(request())).toBe("allowed-admin");
    expect(mocks.verify).toHaveBeenCalledWith(secret, true);
  });
  it("denies a valid Firebase token belonging to another user", async () => {
    mocks.verify.mockResolvedValue({ uid: "someone-else" });
    await expect(requireAdmin(request())).rejects.toMatchObject({ status: 403 });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("denies expired/revoked/invalid tokens", async () => {
    mocks.verify.mockRejectedValue(new Error("sensitive SDK detail"));
    await expect(requireAdmin(request())).rejects.toMatchObject({ status: 401 });
  });
  it("fails closed if server and rules admin UIDs differ", async () => {
    mocks.verify.mockResolvedValue({ uid: "allowed-admin" });
    mocks.get.mockResolvedValue({ data: () => ({ uid: "old-admin" }) });
    expect((await handleApi(async () => { await requireAdmin(request()); return Response.json({}); })).status).toBe(503);
  });
});

describe("device boundary", () => {
  it.each([commands, capture])("denies disabled-device polling and captures", async (handler) => {
    mocks.get.mockResolvedValue({ data: () => ({ enabled: false }) });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
  const device = () => ({ enabled: true, credentialHash: credentialHash("entrance-01", secret),
    label: "Entrance", activeAssignmentId: null, lastSeenAt: null, firmwareVersion: null, updatedAt: Timestamp.now() });
  it("accepts a separate scanner identity and only returns OLED/result information", async () => {
    mocks.get.mockResolvedValue({ data: device });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ resultCode: "authenticated", display: { message: "Scanner authenticated" } });
  });
  it("denies arbitrary device IDs without creating per-ID buckets", async () => {
    await expect(requireDevice(request(secret, "attacker"))).rejects.toMatchObject({ status: 401 });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.throttle).toHaveBeenCalledWith("device-auth", 120);
  });
  it("denies disabled scanners", async () => {
    mocks.get.mockResolvedValue({ data: () => ({ ...device(), enabled: false }) });
    await expect(requireDevice(request())).rejects.toMatchObject({ status: 401 });
  });
  it("denies old credentials after rotation", async () => {
    mocks.get.mockResolvedValue({ data: () => ({ ...device(), credentialHash: credentialHash("entrance-01", "b".repeat(43)) }) });
    await expect(requireDevice(request())).rejects.toMatchObject({ status: 401 });
  });
  it("rechecks disable/rotation against transaction-time state", () => {
    expect(() => assertDeviceCurrent(request(), device())).not.toThrow();
    expect(() => assertDeviceCurrent(request(), { ...device(), enabled: false })).toThrow();
    expect(() => assertDeviceCurrent(request(), { ...device(), credentialHash: "f".repeat(64) })).toThrow();
  });
  it("never exposes SDK errors to the device", async () => {
    mocks.get.mockRejectedValue(new Error("credentialHash: secret, phone: private"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "server-unavailable" });
  });
});

describe("bounded payloads and validation", () => {
  it.each(["09706520", "09:70:65:2", "09:70:65:2a", "09:70:65:20:00:00:00"])("rejects unsupported UID %s", (uid) => {
    expect(() => canonicalUid(uid)).toThrow();
  });
  it("preserves leading zero bytes", () => expect(canonicalUid("09:70:65:20")).toBe("09:70:65:20"));
  it("scopes receipts by both origin and event ID", () => {
    expect(receiptId("qr", "event_0123456789ab")).not.toBe(receiptId("entrance-01", "event_0123456789ab"));
    expect(() => receiptId("qr", "../../bad")).toThrow();
  });
  it("rejects identity mismatches and never falls through from enrollment", () => {
    const body = { deviceId: "entrance-01", uid: "09:70:65:20", eventId: "event_0123456789ab", mode: "enrollment" };
    expect(() => validateCapture(body, "other-device")).toThrow();
    expect(() => validateCapture(body, "entrance-01")).toThrow();
    expect(() => validateCapture({ ...body, mode: "attendance", assignmentId: "old-command" }, "entrance-01")).toThrow();
  });
  it("denies expired, cancelled, foreign, or unreserved commands", () => {
    const assignment = { deviceId: "entrance-01", status: "pending", expiresAt: Timestamp.fromMillis(2000) } as RfidAssignment;
    expect(() => assertCommandOwnership("command", assignment, "entrance-01", "command", 1000)).not.toThrow();
    expect(() => assertCommandOwnership("command", assignment, "entrance-01", null, 1000)).toThrow();
    expect(() => assertCommandOwnership("command", assignment, "other", "command", 1000)).toThrow();
    expect(() => assertCommandOwnership("command", assignment, "entrance-01", "command", 2000)).toThrow();
    expect(() => assertCommandOwnership("command", { ...assignment, status: "cancelled" }, "entrance-01", "command", 1000)).toThrow();
  });
  it("guards missing and deleting profiles", () => {
    expect(() => assertPersonAvailable(undefined)).toThrow();
    expect(() => assertPersonAvailable({ deletingAt: Timestamp.now() })).toThrow();
    expect(() => assertPersonAvailable({})).not.toThrow();
  });
  it("bounds streamed bodies even without Content-Length", async () => {
    const r = new Request("https://reshape.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(2100) }) });
    await expect(readBody(r)).rejects.toMatchObject({ status: 413 });
  });
  it.each(["[]", "null", "{broken"])("rejects invalid body %s", async (body) => {
    await expect(readBody(new Request("https://reshape.test", { method: "POST", headers: { "content-type": "application/json" }, body }))).rejects.toMatchObject({ status: 400 });
  });
});
