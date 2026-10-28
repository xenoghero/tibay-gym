import { requireAdmin } from "@/lib/server/rfid/auth";
import { handleApi, json, readBody, ApiError } from "@/lib/server/rfid/http";
import { startAssignment, cancelAssignment, reservation, OFFLINE_MS } from "@/lib/server/rfid/enrollment";
import { adminDb } from "@/lib/server/firebase-admin";
import { ENTRANCE_DEVICE_ID, type RfidAssignment, type RfidDevice } from "@/lib/rfid/models";
import { documentId } from "@/lib/server/rfid/validation";

export const runtime = "nodejs";
// Bounded admin-only status reads. Request-time expiry releases reservations
// even when the scanner is disconnected; no credential fields are returned.
export async function GET(request: Request) {
  return handleApi(async () => {
    await requireAdmin(request);
    const personId = documentId(new URL(request.url).searchParams.get("personId"));
    const db = adminDb();
    const result = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const device = (await tx.get(db.doc(`rfidDevices/${ENTRANCE_DEVICE_ID}`))).data() as RfidDevice | undefined;
      const current = device ? await reservation(tx, db, device, now) : null;
      const person = (await tx.get(db.doc(`persons/${personId}`))).data();
      if (!person) throw new ApiError(404, "person-unavailable");
      const latest = await tx.get(db.collection("rfidAssignments").where("personId", "==", personId).orderBy("createdAt", "desc").limit(1));
      const target = current?.active ? (await tx.get(db.doc(`persons/${current.assignment!.personId}`))).data() : null;
      const project = (id: string, a: RfidAssignment) => ({ id, personId: a.personId, operation: a.operation,
        status: a.status === "pending" && a.expiresAt.toMillis() <= now ? "expired" : a.status,
        expiresAt: a.expiresAt.toMillis(), capturedUid: a.capturedUid, lastErrorCode: a.lastErrorCode });
      current?.finish();
      return {
        uid: person.rfidTagId ?? null, unavailable: person.deletingAt != null,
        scanner: { online: !!device?.enabled && !!device.lastSeenAt && now - device.lastSeenAt.toMillis() < OFFLINE_MS },
        active: current?.active ? { ...project(current.ref!.id, current.assignment!), personName: target?.name ?? "Unavailable profile" } : null,
        latest: latest.empty ? null : project(latest.docs[0].id, latest.docs[0].data() as RfidAssignment),
      };
    });
    return json(result);
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const uid = await requireAdmin(request);
    const body = await readBody(request);
    return json(await startAssignment(uid, documentId(body.personId), body.operation, body.expectedPreviousUid), 201);
  });
}
export async function PATCH(request: Request) {
  return handleApi(async () => {
    const actorId = await requireAdmin(request);
    const body = await readBody(request);
    if (body.operation !== "cancel") throw new ApiError(400, "invalid-operation");
    return json(await cancelAssignment(documentId(body.assignmentId), actorId));
  });
}
