import { generateKeyPairSync } from "node:crypto";
import { deleteApp, getApps } from "firebase-admin/app";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Exercise the real SDK initialization with a generated test key. No token or
// database request is made.
vi.mock("firebase-admin/app", async importOriginal => importOriginal());
import { adminApp } from "./firebase-admin";

afterEach(async () => {
  await Promise.all(getApps().filter(app => app.name === "reshape-server").map(deleteApp));
  vi.unstubAllEnvs();
});

it("keeps the configured project when reusing the server app across database calls", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" } });
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "reshape-test");
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "reshape-test");
  vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "test@reshape-test.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", privateKey);

  const first = adminApp();
  expect(adminApp()).toBe(first);
  expect(first.options.projectId).toBe("reshape-test");
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "different-project");
  expect(() => adminApp()).toThrow("Firebase app project changed; restart the server");
});
