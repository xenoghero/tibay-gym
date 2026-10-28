import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { assertIsolatedFirebase, emulatorAddress, ISOLATED_FIREBASE_PROJECT } from "./firebase-isolation";

// Client SDK config, read from NEXT_PUBLIC_* env vars (see .env.example).
// These values are not secret — Firestore/Auth security rules are the access boundary.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const isolated = process.env.NEXT_PUBLIC_FIREBASE_ISOLATED === "1";
const firestoreEmulator = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
if (isolated || firebaseConfig.projectId === ISOLATED_FIREBASE_PROJECT) {
  if (!isolated) throw new Error("Demo Firebase requires isolated mode");
  assertIsolatedFirebase(firebaseConfig.projectId, firestoreEmulator, authEmulator);
}

// Use a separate app name so a hot reload cannot reuse a production client in isolated mode.
const appName = isolated ? "reshape-isolated" : "[DEFAULT]";
export const firebaseApp: FirebaseApp =
  getApps().some((app) => app.name === appName) ? getApp(appName) : initializeApp(firebaseConfig, appName);

if (firebaseApp.options.projectId !== firebaseConfig.projectId) {
  throw new Error("Firebase app project changed; reload the page");
}

export const db: Firestore = getFirestore(firebaseApp);
export const auth: Auth = getAuth(firebaseApp);

// Keep connection state across module reloads, before consumers can issue requests.
const emulatorApp = firebaseApp as FirebaseApp & { reshapeEmulatorsConnected?: boolean };
if (isolated && !emulatorApp.reshapeEmulatorsConnected) {
  const firestore = emulatorAddress(firestoreEmulator);
  connectFirestoreEmulator(db, firestore.host, firestore.port);
  connectAuthEmulator(auth, `http://${authEmulator}`, { disableWarnings: true });
  emulatorApp.reshapeEmulatorsConnected = true;
}
