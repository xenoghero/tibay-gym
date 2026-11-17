import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  store: null as ReturnType<typeof import("@/tests/memory-firestore").memoryFirestore> | null,
  tokens: new Map<string, string>(), createUser: vi.fn(), updateUser: vi.fn(), revoke: vi.fn(), deleteUser: vi.fn(),
}));
vi.mock("./firebase-admin", () => ({
  adminDb: () => mocks.store!.db,
  adminAuth: () => ({
    verifyIdToken: async (token: string) => { const uid = mocks.tokens.get(token); if (!uid) throw new Error("forged"); return { uid }; },
    createUser: mocks.createUser, updateUser: mocks.updateUser, revokeRefreshTokens: mocks.revoke, deleteUser: mocks.deleteUser,
  }),
}));
vi.mock("./rfid/rate-limit", () => ({ throttle: async () => {} }));
import { GET as listCoaches, POST as changeCoach } from "@/app/api/admin/coaches/route";
import { GET as coachMe } from "@/app/api/coach/me/route";
import { requireAdmin } from "./rfid/auth";
import { GET as assignments, POST as assign } from "@/app/api/admin/coach-assignments/route";
import { GET as coachClients } from "@/app/api/coach/clients/route";
const NOW = Date.parse("2026-11-17T02:00:00Z");
const token = (uid: string) => { const value = `token-${uid}-0123456789abcdef`; mocks.tokens.set(value, uid); return value; };
const call = (handler: (request: Request) => Promise<Response>, uid: string | null, body?: unknown) => handler(new Request("https://tibay.test/api", {
  method: body === undefined ? "GET" : "POST",
  headers: { "content-type": "application/json", ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const rows = (name: string) => [...mocks.store!.data].filter(([path]) => path.startsWith(`${name}/`)).map(([, value]) => value);
const create = { action: "create", name: "Coach Ana", email: "Ana@Example.com", password: "starting-pass" };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("FIREBASE_ADMIN_ALLOWED_UID", "admin1");
  mocks.store = memoryFirestore(); mocks.tokens.clear();
  mocks.store.data.set("_serverConfig/admin", { uid: "admin1" });
  mocks.createUser.mockResolvedValue({ uid: "coach1" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("lets the admin create a coach as a Firebase email/password user plus a coach record, audited", async () => {
  const response = await call(changeCoach, "admin1", create);
  expect(response.status).toBe(200);
  expect(mocks.createUser).toHaveBeenCalledWith({ email: "ana@example.com", password: "starting-pass", displayName: "Coach Ana" });
  expect(mocks.store!.data.get("coaches/coach1")).toEqual({ name: "Coach Ana", email: "ana@example.com", active: true, createdAt: NOW, deactivatedAt: null });
  expect(rows("auditEvents")).toEqual([expect.objectContaining({ actorId: "admin1", action: "coach-created", entityType: "coach", entityId: "coach1" })]);
  expect(JSON.stringify(rows("auditEvents"))).not.toContain("starting-pass");
  expect(await (await call(listCoaches, "admin1")).json()).toEqual({ coaches: [{ id: "coach1", name: "Coach Ana", email: "ana@example.com", active: true, createdAt: NOW, deactivatedAt: null }] });
});

it("validates coach details and refuses an email that already has a login, including the admin's", async () => {
  for (const body of [{ ...create, name: " " }, { ...create, email: "not-an-email" }, { ...create, password: "short" }]) {
    expect((await call(changeCoach, "admin1", body)).status).toBe(400);
  }
  mocks.createUser.mockRejectedValueOnce(Object.assign(new Error("taken"), { code: "auth/email-already-exists" }));
  const taken = await call(changeCoach, "admin1", create);
  expect([taken.status, (await taken.json()).error]).toEqual([409, "coach-email-taken"]);
  mocks.createUser.mockResolvedValueOnce({ uid: "admin1" });
  expect((await call(changeCoach, "admin1", create)).status).toBe(409);
  expect(mocks.deleteUser).not.toHaveBeenCalledWith("admin1");
  expect(mocks.store!.data.has("coaches/admin1")).toBe(false);
});

it("resets a coach's password and deactivates a coach, disabling the login and revoking tokens", async () => {
  await call(changeCoach, "admin1", create);
  expect((await call(changeCoach, "admin1", { action: "reset-password", coachId: "coach1", password: "brand-new-pass" })).status).toBe(200);
  expect(mocks.updateUser).toHaveBeenCalledWith("coach1", { password: "brand-new-pass" });
  expect(mocks.revoke).toHaveBeenCalledTimes(1);
  expect((await call(changeCoach, "admin1", { action: "deactivate", coachId: "coach1" })).status).toBe(200);
  expect(mocks.updateUser).toHaveBeenCalledWith("coach1", { disabled: true });
  expect(mocks.revoke).toHaveBeenCalledWith("coach1");
  expect(mocks.store!.data.get("coaches/coach1")).toMatchObject({ active: false, deactivatedAt: NOW });
  expect(rows("auditEvents").map(event => event.action).sort()).toEqual(["coach-created", "coach-deactivated", "coach-password-reset"]);
  expect((await call(changeCoach, "admin1", { action: "reset-password", coachId: "coach1", password: "another-pass-1" })).status).toBe(409);
  expect((await call(changeCoach, "admin1", { action: "reset-password", coachId: "missing", password: "brand-new-pass" })).status).toBe(404);
});

it("lets an active coach into coach routes and refuses everyone else", async () => {
  mocks.store!.data.set("coaches/coach1", { name: "Coach Ana", email: "ana@example.com", active: true, createdAt: NOW, deactivatedAt: null });
  mocks.store!.data.set("coaches/old", { name: "Old", email: "old@example.com", active: false, createdAt: NOW, deactivatedAt: NOW });
  // A stray record must never turn the admin into a coach.
  mocks.store!.data.set("coaches/admin1", { name: "Admin", email: "admin@example.com", active: true, createdAt: NOW, deactivatedAt: null });
  const me = await call(coachMe, "coach1");
  expect([me.status, await me.json()]).toEqual([200, { id: "coach1", name: "Coach Ana", email: "ana@example.com" }]);
  expect((await call(coachMe, null)).status).toBe(401);
  expect((await coachMe(new Request("https://tibay.test/api", { headers: { authorization: "Bearer forged-token-0123456789abc" } }))).status).toBe(401);
  for (const uid of ["stranger", "old", "admin1"]) expect((await call(coachMe, uid)).status).toBe(403);
});

it("refuses coaches on admin routes", async () => {
  mocks.store!.data.set("coaches/coach1", { name: "Coach Ana", email: "ana@example.com", active: true, createdAt: NOW, deactivatedAt: null });
  expect((await call(listCoaches, "coach1")).status).toBe(403);
  expect((await call(changeCoach, "coach1", create)).status).toBe(403);
  expect(mocks.createUser).not.toHaveBeenCalled();
  // Every admin route goes through requireAdmin, which is tied to the single admin user ID.
  await expect(requireAdmin(new Request("https://tibay.test/api", { headers: { authorization: `Bearer ${token("coach1")}` } }))).rejects.toMatchObject({ status: 403 });
});

const seedClient = (id: string, extra: Record<string, unknown> = {}) => {
  mocks.store!.data.set(`persons/${id}`, { name: `Client ${id}`, phone: "09123456789", type: "member", status: "active", address: "Private street",
    coachingProfile: { fbName: `fb.${id}`, goals: "Build strength", startDate: "2026-11-20", preferredSchedule: { weekdays: ["mon", "wed"], timeSlot: "evening" }, remarks: "Knee injury" }, ...extra });
  mocks.store!.data.set(`coachingPackages/pkg-${id}`, { id: `pkg-${id}`, personId: id, chargeId: `pkg-${id}`, paymentRequestId: "r", packageId: "pkg-8", priceMinor: 150000,
    sessions: 8, validityDays: 15, status: "active", submittedAt: NOW - 1000, approvedAt: NOW - 900, startedAt: NOW - 800, coachingExpiresAt: NOW + 10 * 86400000, sessionsUsed: 2, topUpSessions: 0 });
  mocks.store!.data.set(`paymentRequests/pay-${id}`, { personId: id, amountMinor: 150000 });
};
const coachRecord = (name: string) => ({ name, email: `${name}@example.com`, active: true, createdAt: NOW, deactivatedAt: null });

it("lists unassigned clients with their preferences, assigns and switches coaches, audited", async () => {
  mocks.store!.data.set("coaches/coach1", coachRecord("Ana")); mocks.store!.data.set("coaches/coach2", coachRecord("Ben"));
  seedClient("c1"); seedClient("c2", { coachingProfile: undefined });
  mocks.store!.data.set("coachingPackages/pkg-c2", { ...mocks.store!.data.get("coachingPackages/pkg-c2"), sessionsUsed: 8 });
  const listed = await (await call(assignments, "admin1")).json();
  expect(listed.unassigned).toEqual([expect.objectContaining({ id: "c1", fbName: "fb.c1", goals: "Build strength", remarks: "Knee injury", sessionsLeft: 6,
    preferredSchedule: { weekdays: ["mon", "wed"], timeSlot: "evening" } })]);
  expect(listed.coaches.map((c: { name: string }) => c.name)).toEqual(["Ana", "Ben"]);
  expect((await call(assign, "admin1", { personId: "c1", coachId: "coach1" })).status).toBe(200);
  expect((await call(assign, "admin1", { personId: "c1", coachId: "coach2" })).status).toBe(200);
  expect((await (await call(assignments, "admin1")).json()).assigned).toEqual([expect.objectContaining({ id: "c1", coachId: "coach2", coachName: "Ben" })]);
  expect(rows("auditEvents").filter(e => e.action === "coach-assigned").map(e => [e.relevantBefore, e.relevantAfter]))
    .toEqual(expect.arrayContaining([[{ coachId: null }, { coachId: "coach1" }], [{ coachId: "coach1" }, { coachId: "coach2" }]]));
  expect((await call(assign, "coach1", { personId: "c1", coachId: "coach1" })).status).toBe(403);
});

it("shows a coach only their own clients, without address or payments", async () => {
  mocks.store!.data.set("coaches/coach1", coachRecord("Ana")); mocks.store!.data.set("coaches/coach2", coachRecord("Ben"));
  seedClient("c1"); seedClient("c2");
  mocks.store!.data.set("coachAssignments/c1", { personId: "c1", coachId: "coach1", assignedAt: NOW, assignedBy: "admin1" });
  mocks.store!.data.set("coachAssignments/c2", { personId: "c2", coachId: "coach2", assignedAt: NOW, assignedBy: "admin1" });
  const list = await (await call(coachClients, "coach1")).json();
  expect(list.clients.map((c: { id: string }) => c.id)).toEqual(["c1"]);
  const detail = await coachClients(new Request("https://tibay.test/api?id=c1", { headers: { authorization: `Bearer ${token("coach1")}` } }));
  const body = await detail.json();
  expect(body.client).toMatchObject({ name: "Client c1", phone: "09123456789", fbName: "fb.c1", sessionsLeft: 6, frozen: false });
  expect(JSON.stringify([list, body])).not.toMatch(/Private street|address|amountMinor|payment/i);
  const other = await coachClients(new Request("https://tibay.test/api?id=c2", { headers: { authorization: `Bearer ${token("coach1")}` } }));
  expect([other.status, (await other.json()).error]).toEqual([403, "client-not-assigned"]);
  expect((await call(coachClients, "admin1")).status).toBe(403);
});

it("returns a deactivated coach's clients to Unassigned clients", async () => {
  mocks.store!.data.set("coaches/coach1", coachRecord("Ana")); seedClient("c1");
  mocks.store!.data.set("coachAssignments/c1", { personId: "c1", coachId: "coach1", assignedAt: NOW, assignedBy: "admin1" });
  await call(changeCoach, "admin1", { action: "deactivate", coachId: "coach1" });
  expect(mocks.store!.data.has("coachAssignments/c1")).toBe(false);
  expect((await (await call(assignments, "admin1")).json()).unassigned.map((c: { id: string }) => c.id)).toEqual(["c1"]);
  expect(rows("auditEvents").some(e => e.action === "coach-assignment-cleared")).toBe(true);
});
