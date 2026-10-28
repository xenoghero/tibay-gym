import { vi } from "vitest";

// Tests must explicitly mock SDK initialization or the application's Firebase
// adapters. An accidentally unmocked adapter fails before any SDK connection.
vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  cert: () => { throw new Error("Real Firebase credentials are forbidden in unit tests"); },
  initializeApp: () => { throw new Error("Mock Firebase before running write-capable tests"); },
}));
vi.mock("firebase/app", () => ({
  getApps: () => [],
  getApp: () => { throw new Error("Mock browser Firebase in unit tests"); },
  initializeApp: () => { throw new Error("Mock browser Firebase in unit tests"); },
}));
