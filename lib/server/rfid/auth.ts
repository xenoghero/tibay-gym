import "server-only";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import { ENTRANCE_DEVICE_ID, type RfidDevice } from "@/lib/rfid/models";
import { ApiError, bearer } from "./http";
import { credentialMatches } from "./validation";
import { throttle } from "./rate-limit";

export async function requireAdmin(request: Request): Promise<string> {
  const token = bearer(request);
  await throttle("admin-auth", 120);
  const allowedUid = process.env.FIREBASE_ADMIN_ALLOWED_UID;
  if (!allowedUid) throw new Error("Allowed admin UID is not configured");
  let uid: string;
  try { uid = (await adminAuth().verifyIdToken(token, true)).uid; }
  catch { throw new ApiError(401, "unauthorized"); }
  if (uid !== allowedUid) throw new ApiError(403, "admin-required");
  // Both server authorization and browser rules use the same deployed identity.
  const config = await adminDb().doc("_serverConfig/admin").get();
  if (config.data()?.uid !== allowedUid) throw new Error("Admin rules identity is not synchronized");
  return uid;
}

export async function requireDevice(request: Request): Promise<{ id: string; device: RfidDevice }> {
  const secret = bearer(request);
  // One scanner only. Unknown headers cannot allocate unbounded throttle buckets.
  await throttle("device-auth", 120);
  if (request.headers.get("x-rfid-device-id") !== ENTRANCE_DEVICE_ID) throw new ApiError(401, "unauthorized");
  const snapshot = await adminDb().doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`).get();
  const device = snapshot.data() as RfidDevice | undefined;
  if (!device || !device.enabled || !credentialMatches(ENTRANCE_DEVICE_ID, secret, device.credentialHash)) {
    throw new ApiError(401, "unauthorized");
  }
  await throttle(`device:${ENTRANCE_DEVICE_ID}`, 60);
  return { id: ENTRANCE_DEVICE_ID, device };
}

// Future mutation transactions must re-read this document so disable/rotation
// conflicts with an in-flight mutation rather than accepting a stale identity.
export function assertDeviceCurrent(request: Request, current: RfidDevice | undefined): void {
  if (!current?.enabled || !credentialMatches(ENTRANCE_DEVICE_ID, bearer(request), current.credentialHash)) {
    throw new ApiError(401, "unauthorized");
  }
}
