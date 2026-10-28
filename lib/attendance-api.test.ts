import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), token: vi.fn(async () => "test-admin-token") }));
vi.mock("./firebase", () => ({ db: {}, auth: { currentUser: { getIdToken: mocks.token } } }));
import { attendanceApi } from "./attendance-api";
import { closeStaleSessions } from "./db/attendance-log";

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());
it.each(["no-open-session", "checkout-session-changed", "rate-limited"])("preserves the %s error code", async code => {
  mocks.fetch.mockResolvedValue(Response.json({ error: code }, { status: 409 }));
  await expect(attendanceApi("/api/attendance/lookup", {})).rejects.toMatchObject({ code, status: 409 });
});
it("dashboard cleanup explicitly sends admin intent and an ID token", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ closed: 2 }));
  expect(await closeStaleSessions({ caller: "admin" })).toBe(2);
  expect(mocks.token).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledWith("/api/attendance/auto-close", expect.objectContaining({
    body: JSON.stringify({ caller: "admin" }), headers: expect.objectContaining({ Authorization: "Bearer test-admin-token" }),
  }));
});
it("public cleanup works without an admin token", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ closed: 0 }));
  await closeStaleSessions({ caller: "public" });
  expect(mocks.token).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledWith("/api/attendance/auto-close", expect.objectContaining({
    body: JSON.stringify({ caller: "public" }), headers: { "Content-Type": "application/json" },
  }));
});
it("network and unreadable responses expose sanitized uncertain outcomes", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("SDK/request/location details"));
  await expect(attendanceApi("/api/attendance/scan", {})).rejects.toMatchObject({ code: "network-unconfirmed", status: 0 });
  mocks.fetch.mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
  await expect(attendanceApi("/api/attendance/scan", {})).rejects.toMatchObject({ code: "invalid-response" });
});
it("expired confirmation never directs the visitor to front-desk or RFID fallback", async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: "retry-expired" }, { status: 409 }));
  await expect(attendanceApi("/api/attendance/scan", {})).rejects.toThrow(/Attendance is still unconfirmed/);
});
it("preserves cooldown wait metadata from the response header or body", async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: "attendance-cooldown", retryAfterSeconds: 24 },
    { status: 429, headers: { "Retry-After": "24" } }));
  await expect(attendanceApi("/api/attendance/scan", {})).rejects.toMatchObject({
    code: "attendance-cooldown", status: 429, retryAfterSeconds: 24,
  });
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: "rate-limited", retryAfterSeconds: 900 }, { status: 429 }));
  await expect(attendanceApi("/api/attendance/scan", {})).rejects.toMatchObject({ retryAfterSeconds: 900 });
});
