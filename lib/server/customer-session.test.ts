import { beforeEach, expect, it, vi } from "vitest";
import { memoryFirestore } from "@/tests/memory-firestore";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ store: null as ReturnType<typeof memoryFirestore> | null, limit: vi.fn() }));
vi.mock("./firebase-admin", () => ({ adminDb: () => mocks.store!.db }));
vi.mock("./public-rate-limit", () => ({ publicCaller: () => "test", publicRateLimiter: { consume: mocks.limit } }));
import { createCustomerSession, requireCustomer, sessionCookie } from "./customer-session";
import { POST, GET, DELETE } from "@/app/api/customer/session/route";
beforeEach(() => { mocks.store = memoryFirestore(); mocks.limit.mockReset(); mocks.store.data.set("persons/p1", { phone: "09123456789", type: "guest", status: null, name: "Private", address: "Private", rfidTagId: "Private" }); });
const request = (token: string, origin?: string) => new Request("https://test/api", { headers: { cookie: `tibay_customer=${token}`, ...(origin ? { origin } : {}) } });
it("stores only a session hash, binds it to the looked-up customer and expires it", async () => {
  const result = await createCustomerSession("09123456789");
  const rows = [...mocks.store!.data].filter(([path]) => path.startsWith("customerSessions/"));
  expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain(result.token);
  expect((await requireCustomer(request(result.token))).session.personId).toBe("p1");
  rows[0][1].expiresAt = Date.now() - 1;
  await expect(requireCustomer(request(result.token))).rejects.toMatchObject({ status: 401 });
});
it("revokes the server session on sign-out, expires the cookie and permits idempotent retries", async () => {
  const { token } = await createCustomerSession("09123456789");
  const response = await DELETE(request(token));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  await expect(requireCustomer(request(token))).rejects.toMatchObject({ code: "customer-session-expired" });
  expect((await DELETE(request(token))).status).toBe(200);
  expect((await DELETE(request("missing"))).status).toBe(200);
});
it("rejects cross-site sign-out and revokes an existing session when switching accounts", async () => {
  const { token } = await createCustomerSession("09123456789");
  expect((await DELETE(request(token, "https://evil.invalid"))).status).toBe(403);
  expect((await requireCustomer(request(token))).session.personId).toBe("p1");
  const response = await POST(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json", cookie: `tibay_customer=${token}` }, body: JSON.stringify({ phone: "09123456789" }) }));
  expect(response.status).toBe(200);
  await expect(requireCustomer(request(token))).rejects.toMatchObject({ code: "customer-session-expired" });
});
it("rejects forged tokens, revoked sessions, cross-site operations and deleted customers", async () => {
  await expect(requireCustomer(request("forged"))).rejects.toMatchObject({ status: 401 });
  const { token } = await createCustomerSession("09123456789");
  await expect(requireCustomer(request(token, "https://evil.invalid"))).rejects.toMatchObject({ status: 403 });
  mocks.store!.data.get("persons/p1")!.deletingAt = true;
  await expect(requireCustomer(request(token))).rejects.toMatchObject({ status: 401 });
});
it("keeps sessions working when pending approval preserves the customer ID", async () => {
  const person = mocks.store!.data.get("persons/p1")!; mocks.store!.data.delete("persons/p1"); mocks.store!.data.set("unverifiedPersons/p1", person);
  const { token } = await createCustomerSession("09123456789");
  expect((await requireCustomer(request(token))).official).toBe(false);
  mocks.store!.data.delete("unverifiedPersons/p1"); mocks.store!.data.set("persons/p1", person);
  expect((await requireCustomer(request(token))).official).toBe(true);
});
it("returns a minimal status projection with a private cookie, never a raw session or private profile", async () => {
  const response = await POST(new Request("https://test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "09123456789", personId: "someone-else" }) }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly; SameSite=Strict/); expect(cookie).toMatch(/Max-Age=1800/);
  expect(Object.keys(await response.json())).toEqual(["expiresAt"]);
  const status = await (await GET(new Request("https://test/api", { headers: { cookie } }))).json();
  expect(status).toMatchObject({ type: "guest", verified: true, rateCategory: null });
  expect(JSON.stringify(status)).not.toMatch(/Private|phone|rfidTagId|personId/);
  expect(sessionCookie("token")).toContain("Path=/api");
});
it("throttles session creation before any lookup", async () => {
  const { ApiError } = await import("./rfid/http"); mocks.limit.mockImplementation(() => { throw new ApiError(429, "rate-limited"); });
  const result = await POST(new Request("https://test/api", { method: "POST" }));
  expect(result.status).toBe(429); expect(mocks.store!.operations).toHaveLength(0);
});
