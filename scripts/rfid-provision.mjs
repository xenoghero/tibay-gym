import nextEnv from "@next/env";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const [operation, outputPath] = process.argv.slice(2);
if (!["admin", "provision", "rotate", "enable", "disable"].includes(operation)) {
  throw new Error("Usage: npm run rfid:provision -- admin|provision|rotate|enable|disable [credential output path]");
}
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
  throw new Error("Configure matching Firebase projects and server credentials first");
}
const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(app);
const deviceId = "entrance-01";
const ref = db.doc(`rfidDevices/${deviceId}`);

if (operation === "admin") {
  const uid = process.env.FIREBASE_ADMIN_ALLOWED_UID;
  if (!uid) throw new Error("Set FIREBASE_ADMIN_ALLOWED_UID to the existing admin's Firebase UID");
  const user = await getAuth(app).getUser(uid);
  if (user.disabled) throw new Error("Configured admin is disabled");
  await db.doc("_serverConfig/admin").set({ uid, updatedAt: Timestamp.now() });
} else if (operation === "enable" || operation === "disable") {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Provision the device first");
    const d = snap.data();
    const enabled = operation === "enable";
    const updatedAt = Timestamp.now();
    tx.update(ref, { enabled, updatedAt });
    tx.set(db.doc(`rfidDeviceStatus/${deviceId}`), { label: d.label, enabled, lastSeenAt: d.lastSeenAt, updatedAt });
  });
} else {
  if (!outputPath) throw new Error("Supply a NEW credential output file outside the repository");
  const file = resolve(outputPath);
  const rel = relative(process.cwd(), file);
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../"))
    throw new Error("Credential output must be outside the repository");
  const secret = randomBytes(32).toString("base64url");
  const credentialHash = createHash("sha256").update(`reshape-rfid-v1\0${deviceId}\0${secret}`).digest("hex");
  // Exclusive write before commit avoids rotating into an undeliverable secret.
  await writeFile(file, JSON.stringify({ deviceId, credential: secret }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (operation === "provision" && snap.exists) throw new Error("Device exists; use rotate");
      if (operation === "rotate" && !snap.exists) throw new Error("Provision the device first");
      const updatedAt = Timestamp.now();
      const d = snap.data();
      const device = { label: d?.label ?? "Entrance scanner", enabled: false, credentialHash,
        activeAssignmentId: d?.activeAssignmentId ?? null, lastSeenAt: null,
        firmwareVersion: d?.firmwareVersion ?? null, updatedAt };
      tx.set(ref, device);
      tx.set(db.doc(`rfidDeviceStatus/${deviceId}`), { label: device.label, enabled: false, lastSeenAt: null, updatedAt });
    });
  } catch (error) {
    // Keep the file for uncertain network outcomes; never discard a possibly
    // committed credential. Remove only known precondition failures.
    if (["Device exists; use rotate", "Provision the device first"].includes(error.message)) await unlink(file);
    throw error;
  }
}
console.log(`RFID ${operation} completed for project ${projectId}.`);
