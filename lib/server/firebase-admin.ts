import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertIsolatedFirebase, ISOLATED_FIREBASE_PROJECT } from "@/lib/firebase-isolation";

// Lazy initialization keeps builds independent of production credentials.
export function adminApp() {
  const isolated = process.env.NEXT_PUBLIC_FIREBASE_ISOLATED === "1";
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  if (isolated || projectId === ISOLATED_FIREBASE_PROJECT) {
    if (!isolated || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
      throw new Error("Server and browser isolated Firebase settings must match");
    }
    assertIsolatedFirebase(projectId, process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST);
  }
  const existing = getApps().find((app) => app.name === "reshape-server");
  if (existing) {
    if (existing.options.projectId !== projectId) throw new Error("Firebase app project changed; restart the server");
    return existing;
  }
  if (isolated) return initializeApp({ projectId }, "reshape-server");
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase server credentials are not configured");
  }
  if (projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error("Server and browser Firebase projects must match");
  }
  return initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey }) }, "reshape-server");
}

export const adminDb = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
