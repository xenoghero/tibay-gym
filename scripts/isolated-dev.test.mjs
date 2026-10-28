import { expect, it } from "vitest";
import { isolatedEnvironment } from "./isolated-dev.mjs";

it("overrides inherited production settings without exposing credentials", () => {
  const env = isolatedEnvironment({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "real-project",
    FIREBASE_ADMIN_PRIVATE_KEY: "real-key", GOOGLE_APPLICATION_CREDENTIALS: "real-file",
    FIRESTORE_EMULATOR_HOST: "remote:8080", CRON_SECRET: "real-secret", PATH: "keep" });
  expect(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe("demo-reshape-attendance");
  expect(env.FIREBASE_ADMIN_PROJECT_ID).toBe(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  expect(env.FIREBASE_ADMIN_PRIVATE_KEY).toBe("");
  expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe("");
  expect(env.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
  expect(env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST).toBe(env.FIRESTORE_EMULATOR_HOST);
  expect(env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST).toBe(env.FIREBASE_AUTH_EMULATOR_HOST);
  expect(env.CRON_SECRET).toBe("isolated-cleanup-secret");
  expect(env.PATH).toBe("keep");
});
