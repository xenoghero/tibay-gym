import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { ADMIN, PROJECT } from "./fixtures";

const FIRESTORE = "127.0.0.1:8080", AUTH = "127.0.0.1:9099";

/** Wipes the emulators and seeds the one admin plus finance settings, so every run starts from an empty gym. */
export default async function globalSetup() {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
  for (const url of [`http://${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, `http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`]) {
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) throw new Error(`Could not reset emulator ${url}: ${response.status}`);
  }
  const app = initializeApp({ projectId: PROJECT }, `e2e-${Date.now()}`);
  try {
    // isolated-dev.mjs allows exactly this admin UID.
    await getAuth(app).createUser({ uid: "isolated-admin", email: ADMIN.email, password: ADMIN.password, displayName: "Admin" });
    const db = getFirestore(app), now = Date.now();
    await db.doc("_serverConfig/admin").set({ uid: "isolated-admin" });
    // Purchases need finance switched on (a cutover time) and monthly rates.
    await db.doc("gymSettings/finance").set({
      currency: "PHP", timeZone: "Asia/Manila", weekStartsOn: "Monday",
      studentDailyMinor: 6000, regularDailyMinor: 7000, studentMonthlyMinor: 100000, regularMonthlyMinor: 120000,
      rateRevision: 1, financialCutoverAt: now - 60_000, updatedAt: now, updatedBy: "isolated-admin",
    });
  } finally { await deleteApp(app); }
}
