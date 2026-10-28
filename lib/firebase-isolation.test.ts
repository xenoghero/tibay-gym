import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedFirebase, emulatorAddress, ISOLATED_FIREBASE_PROJECT } from "./firebase-isolation";

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }));
const sdk = vi.hoisted(() => ({
  initialize: vi.fn((options: Record<string, unknown>, name: string) => ({ options, name })),
  cert: vi.fn(), firestore: vi.fn(), auth: vi.fn(),
  existing: [] as Array<{ options: Record<string, unknown>; name: string }>,
}));
vi.mock("firebase-admin/app", () => ({
  getApps: () => sdk.existing, initializeApp: sdk.initialize, cert: sdk.cert,
}));
vi.mock("firebase/app", () => ({
  getApps: () => sdk.existing, getApp: (name: string) => sdk.existing.find(app => app.name === name), initializeApp: sdk.initialize,
}));
vi.mock("firebase/firestore", () => ({ getFirestore: () => ({}), connectFirestoreEmulator: sdk.firestore }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}), connectAuthEmulator: sdk.auth }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); sdk.existing = [];
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "1");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", ISOLATED_FIREBASE_PROJECT);
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", ISOLATED_FIREBASE_PROJECT);
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
  vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
  vi.stubEnv("NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "", "https://127.0.0.1:8080", "firestore.googleapis.com:443", "127.0.0.1:0", "localhost:65536"])(
  "rejects unsafe or missing emulator endpoint %s", value => {
    expect(() => emulatorAddress(value)).toThrow();
  });
it("rejects real projects even with valid emulator endpoints", () => {
  expect(() => assertIsolatedFirebase("real-project", "127.0.0.1:8080", "127.0.0.1:9099")).toThrow();
});
it("initializes the server with only the demo project, never service-account credentials", async () => {
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "must-not-be-used");
  const { adminApp } = await import("./server/firebase-admin");
  adminApp();
  expect(sdk.initialize).toHaveBeenCalledWith({ projectId: ISOLATED_FIREBASE_PROJECT }, "reshape-server");
  expect(sdk.cert).not.toHaveBeenCalled();
});
it.each(["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"])("server fails before SDK initialization without %s", async key => {
  vi.stubEnv(key, "");
  const { adminApp } = await import("./server/firebase-admin");
  expect(() => adminApp()).toThrow();
  expect(sdk.initialize).not.toHaveBeenCalled();
});
it("does not reuse an existing server app from another project", async () => {
  sdk.existing = [{ name: "reshape-server", options: { projectId: "real-project" } }];
  const { adminApp } = await import("./server/firebase-admin");
  expect(() => adminApp()).toThrow(/restart/);
});
it("connects both browser services to emulators before exporting them", async () => {
  await import("./firebase");
  expect(sdk.initialize).toHaveBeenCalledWith(expect.objectContaining({ projectId: ISOLATED_FIREBASE_PROJECT }), "reshape-isolated");
  expect(sdk.firestore).toHaveBeenCalledWith({}, "127.0.0.1", 8080);
  expect(sdk.auth).toHaveBeenCalledWith({}, "http://127.0.0.1:9099", { disableWarnings: true });
});
it("browser fails before SDK initialization when isolated settings reference production", async () => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "real-project");
  await expect(import("./firebase")).rejects.toThrow();
  expect(sdk.initialize).not.toHaveBeenCalled();
});
