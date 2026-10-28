import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }));
it("blocks an accidentally unmocked server adapter before connecting", async () => {
  vi.stubEnv("FIREBASE_ADMIN_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "");
  vi.stubEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "test@example.invalid");
  vi.stubEnv("FIREBASE_ADMIN_PRIVATE_KEY", "test-key");
  try {
    const { adminApp } = await import("@/lib/server/firebase-admin");
    expect(() => adminApp()).toThrow(/forbidden in unit tests/);
  } finally { vi.unstubAllEnvs(); }
});
it("blocks an accidentally unmocked browser adapter before connecting", async () => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
  try { await expect(import("@/lib/firebase")).rejects.toThrow(/Mock browser Firebase/); }
  finally { vi.unstubAllEnvs(); }
});
