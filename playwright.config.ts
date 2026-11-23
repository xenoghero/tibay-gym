import { defineConfig, devices } from "@playwright/test";

// Coaching smoke suite. Runs only against the Firebase emulators and the isolated demo project,
// never the live tibay-gym data. Needs JDK 21+ on PATH for the emulators.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts", // not *.spec.ts, so `npm test` (Vitest) never picks these up
  globalSetup: "./e2e/global-setup.ts",
  // The journeys share one gym's data and build on each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // Next compiles each page on first visit in dev, so allow for slow first loads.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  outputDir: "e2e/results",
  use: {
    // localhost, not 127.0.0.1: Next dev reports request.url as localhost, and the public routes' same-origin check compares the two.
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    timezoneId: "Asia/Manila",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "firebase emulators:start --only firestore,auth --project demo-reshape-attendance",
      url: "http://127.0.0.1:9099",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `node scripts/isolated-dev.mjs --port ${PORT}`,
      // The public rate limits stay on; each test sends its own caller IP in this header (see e2e/coaching.e2e.ts).
      env: { E2E_DIST_DIR: ".next/e2e", PUBLIC_RATE_LIMIT_IP_HEADER: "x-e2e-caller" },
      url: `http://127.0.0.1:${PORT}/login`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
