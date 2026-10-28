import { afterEach, expect, it, vi } from "vitest";
const token = vi.hoisted(() => vi.fn(async () => "admin-token"));
vi.mock("./firebase", () => ({ auth: { currentUser: { getIdToken: token } } }));
import { adminMutation } from "./admin-api";
afterEach(() => vi.unstubAllGlobals());
it("keeps the same operation after network uncertainty and serializes timestamp fields", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const input = { personId: "p-retry", expiry: { toMillis: () => 1800000000000 } };
  await expect(adminMutation("renew", input)).rejects.toThrow("Retry the same action");
  await adminMutation("renew", input);
  const bodies = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies[0].operationId).toBe(bodies[1].operationId);
  expect(bodies[0].expiry).toEqual({ $timestamp: 1800000000000 });
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-token");
});
