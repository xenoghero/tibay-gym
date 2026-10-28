import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";
import { requireAdmin } from "@/lib/server/rfid/auth";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { ENTRANCE_DEVICE_ID, type RfidDevice } from "@/lib/rfid/models";
import { OFFLINE_MS } from "@/lib/server/rfid/enrollment";
import { appendAudit } from "@/lib/server/audit";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleApi(async () => {
    await requireAdmin(request);
    const snapshot = await adminDb().doc(`rfidDeviceStatus/${ENTRANCE_DEVICE_ID}`).get();
    const d = snapshot.data();
    if (!d) throw new ApiError(404, "device-not-provisioned");
    return json({ deviceId: ENTRANCE_DEVICE_ID, label: d.label, enabled: d.enabled,
      lastSeenAt: d.lastSeenAt?.toMillis() ?? null,
      online: d.enabled && d.lastSeenAt != null && Date.now() - d.lastSeenAt.toMillis() < OFFLINE_MS });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    const body = await readBody(request);
    if (Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") throw new ApiError(400, "invalid-body");
    const ref = adminDb().doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`);
    const operationId = randomUUID();
    await adminDb().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new ApiError(404, "device-not-provisioned");
      const device = snapshot.data() as RfidDevice;
      if (device.enabled === body.enabled) return;
      const updatedAt = Timestamp.now();
      tx.update(ref, { enabled: body.enabled, updatedAt });
      tx.set(adminDb().doc(`rfidDeviceStatus/${ENTRANCE_DEVICE_ID}`), {
        label: device.label, enabled: body.enabled, lastSeenAt: device.lastSeenAt, updatedAt,
      });
      appendAudit(tx, adminDb(), { actorId, action: "rfid-device-updated", entityType: "rfidDevice", entityId: ENTRANCE_DEVICE_ID,
        personId: null, operationId, before: { enabled: device.enabled }, after: { enabled: body.enabled } });
    });
    return json({ resultCode: "device-updated" });
  });
}
