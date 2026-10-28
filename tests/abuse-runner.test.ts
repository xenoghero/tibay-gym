import { expect, it } from "vitest";
import { localOrigin, runHttpChecks } from "../scripts/test-abuse.mjs";

it("restricts HTTP mode to a plain loopback origin", () => {
  expect(localOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  for (const url of ["https://example.com", "http://192.168.1.2", "http://localhost.example.com",
    "http://user:secret@localhost", "http://localhost/path", "http://localhost?url=remote"]) {
    expect(() => localOrigin(url)).toThrow();
  }
});
it("reports success only when both endpoint budgets and continued rejection hold", async () => {
  const calls = new Map<string, number>();
  let active = 0;
  let peak = 0;
  let total = 0;
  const fakeFetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    active++; total++; peak = Math.max(peak, active);
    await Promise.resolve(); active--;
    if (url.endsWith("/checkin")) return new Response("test page");
    const count = (calls.get(url) ?? 0) + 1; calls.set(url, count);
    return count <= (url.endsWith("lookup") ? 20 : 3)
      ? Response.json({ error: "invalid-body" }, { status: 400 })
      : Response.json({ error: "rate-limited", retryAfterSeconds: 10 }, { status: 429, headers: { "Retry-After": "10" } });
  };
  const report = await runHttpChecks("http://127.0.0.1:3000", fakeFetch);
  expect(report).toMatchObject({ requests: 110, validationRejected: 23, rateLimited: 85 });
  expect(total).toBe(110); expect(peak).toBeLessThanOrEqual(4);
});
it("does not report a pass when throttling is absent", async () => {
  const fakeFetch = async (url: RequestInfo | URL) => String(url).endsWith("/checkin") ? new Response("page") :
    Response.json({ error: "invalid-body" }, { status: 400 });
  await expect(runHttpChecks("http://localhost:3000", fakeFetch)).rejects.toThrow(/Lookup budget/);
});
it("rejects server failures and missing wait metadata instead of treating them as blocks", async () => {
  await expect(runHttpChecks("http://localhost:3000", async () => new Response("failure", { status: 503 })))
    .rejects.toThrow(/503/);
  const fakeFetch = async (url: RequestInfo | URL) => String(url).endsWith("/checkin") ? new Response("page") :
    Response.json({ error: "rate-limited" }, { status: 429 });
  await expect(runHttpChecks("http://localhost:3000", fakeFetch)).rejects.toThrow(/missing wait metadata/);
});
