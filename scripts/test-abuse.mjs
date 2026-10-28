import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;

export function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("HTTP checks require a plain loopback HTTP origin, e.g. http://127.0.0.1:3000");
  }
  return url.origin;
}

async function batch(count, work) {
  let index = 0;
  const results = new Array(count);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, count) }, async () => {
    while (index < count) {
      const current = index++;
      results[current] = await work(current);
    }
  }));
  return results;
}

function countStatus(rows, status) { return rows.filter(row => row.status === status).length; }

/** Only invalid bodies are sent. These must fail validation before database work.
 * Passing this check establishes application throttling, not distributed DDoS capacity. */
export async function runHttpChecks(value, fetcher = fetch) {
  const origin = localOrigin(value);
  async function page() {
    const response = await fetcher(`${origin}/checkin`, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.text();
    if (response.status !== 200) throw new Error(`Check-in page returned ${response.status}; expected 200`);
  }
  async function send(path, index) {
    const start = performance.now();
    const response = await fetcher(`${origin}/api/attendance/${path}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json",
        // Deliberately rotate caller-controlled headers to detect accidental trust.
        "X-Forwarded-For": `192.0.2.${index % 250 + 1}`,
        "X-Real-IP": `198.51.100.${index % 250 + 1}`,
        "X-VerCel-Forwarded-For": `203.0.113.${index % 250 + 1}` },
      body: JSON.stringify(path === "lookup" ? { phone: "invalid" } : {}),
    });
    const data = await response.json();
    const wait = Number(response.headers.get("Retry-After"));
    if (![400, 429].includes(response.status)) throw new Error(`${path}: unexpected HTTP ${response.status}`);
    if (response.status === 429 && (data.error !== "rate-limited" || !Number.isInteger(wait) || wait < 1 ||
        !Number.isInteger(data.retryAfterSeconds) || data.retryAfterSeconds !== wait)) {
      throw new Error(`${path}: invalid rate-limit response or missing wait metadata`);
    }
    return { status: response.status, elapsedMs: performance.now() - start };
  }
  await page();
  const lookup = await batch(32, i => send("lookup", i));
  if (countStatus(lookup, 400) !== 20 || countStatus(lookup, 429) !== 12) {
    throw new Error(`Lookup budget: expected 20 validation rejections + 12 throttles; got ${countStatus(lookup, 400)} + ${countStatus(lookup, 429)}. Restart the local server and stop other traffic before retesting.`);
  }
  const scan = await batch(12, i => send("scan", i));
  if (countStatus(scan, 400) !== 3 || countStatus(scan, 429) !== 9) {
    throw new Error(`Scan burst: expected 3 validation rejections + 9 throttles; got ${countStatus(scan, 400)} + ${countStatus(scan, 429)}. Restart the local server before retesting.`);
  }
  // Keep this phase within the ten-second burst window. Start the clock after
  // compilation of both routes, which happens in the preceding phases.
  const started = performance.now();
  const flood = await batch(64, i => send(i % 2 ? "lookup" : "scan", i + 50));
  if (performance.now() - started >= 9000) throw new Error("HTTP test was too slow to assess the burst window reliably; result is inconclusive.");
  if (countStatus(flood, 429) !== flood.length) throw new Error("Some exhausted requests bypassed the limit; inspect the local server and caller-header configuration.");
  await page();
  const rows = [...lookup, ...scan, ...flood];
  const latencies = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  return {
    scope: "Single local process; invalid request flood, not a distributed DDoS test",
    origin, concurrency: CONCURRENCY, requests: rows.length + 2,
    validationRejected: countStatus(rows, 400), rateLimited: countStatus(rows, 429),
    p95Ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]),
    checks: ["lookup budget", "scan burst", "untrusted forwarding-header rotation",
      "continued rejection after budget exhaustion", "Retry-After metadata", "page responds before/after flood"],
  };
}

async function regressions() {
  const args = [resolve(root, "node_modules/vitest/vitest.mjs"), "run",
    "tests/abuse.integration.test.ts", "lib/server/public-rate-limit.test.ts",
    "lib/server/attendance.test.ts", "lib/server/attendance-routes.test.ts",
    "components/checkin/checkin-flow.dom.test.tsx", "--reporter=verbose"];
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    const stop = () => child.kill();
    process.once("SIGINT", stop);
    child.once("error", reject);
    child.once("exit", code => {
      process.removeListener("SIGINT", stop);
      if (code === 0) done(); else reject(new Error("Abuse regression tests failed; see results above."));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("npm run test:abuse\n  Repeatable abuse regressions using the test-only database adapter.\n\nnpm run test:abuse:http\n  Bounded HTTP check against a freshly restarted local server. Start it with npm run dev:isolated. No emulators required for the HTTP check.\n\nCustom port: node scripts/test-abuse.mjs --http --url http://127.0.0.1:3001\nNeither mode measures real distributed DDoS resistance.");
    return;
  }
  let origin = "http://127.0.0.1:3000";
  let http = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--http") http = true;
    else if (args[i] === "--url" && args[i + 1]) origin = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  localOrigin(origin);
  if (http) {
    console.log("HTTP abuse check: 110 requests maximum, concurrency 4. Use a fresh isolated local server with no trusted-IP header configured.");
    console.log(JSON.stringify(await runHttpChecks(origin), null, 2));
    console.log("PASS: the tested local request limits held. Guest creation and attendance cooldown are covered by npm run test:abuse.");
  } else {
    await regressions();
    console.log("PASS: abuse regressions passed with the test-only database adapter. No live Firebase or external targets were contacted.\nRun npm run test:abuse:http to also check a real local HTTP server. These results do not establish distributed DDoS resistance.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
}
