import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";
import { ApiError, handleApi, json, readBody } from "@/lib/server/rfid/http";
import { eventId } from "@/lib/server/rfid/validation";
import { attendancePhone, attendanceText, onlyFields } from "@/lib/server/attendance-request";
import { registrationFields } from "@/lib/registration";
import { publicCaller, publicRateLimiter } from "@/lib/server/public-rate-limit";
import { sameOrigin } from "@/lib/server/customer-session";
import { appendAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleApi(async () => {
    sameOrigin(request);
    const caller = publicCaller(request);
    publicRateLimiter.consume(caller, "scan");
    const body = await readBody(request, 4096);
    onlyFields(body, ["eventId", "phone", "name", "address", "rateCategory", "leadSource", "leadSourceOther"]);
    const operationId = eventId(body.eventId);
    let fields;
    try { fields = registrationFields(body); } catch { throw new ApiError(400, "registration-fields-required"); }
    const profile = { phone: attendancePhone(body.phone), name: attendanceText(body.name, 120),
      address: attendanceText(body.address, 500, true), ...fields };
    const digest = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
    publicRateLimiter.consume(caller, "guest", JSON.stringify([operationId, digest]));
    const personId = `registration-${createHash("sha256").update(operationId).digest("hex")}`;
    const db = adminDb();
    await db.runTransaction(async tx => {
      const ref = db.doc(`unverifiedPersons/${personId}`);
      const previous = (await tx.get(ref)).data();
      const official = (await tx.get(db.doc(`persons/${personId}`))).data();
      const deleted = (await tx.get(db.doc(`deletedPersonIds/${personId}`))).data();
      if (deleted || previous?.deletingAt) throw new ApiError(409, "registration-reuse");
      // A stable operation ID makes a lost registration response safe to retry.
      if (previous) {
        if (previous.registrationFingerprint !== digest) throw new ApiError(409, "guest-conflict");
        return;
      }
      if (official) {
        if (official.phone !== profile.phone) throw new ApiError(409, "guest-conflict");
        return;
      }
      const matching = await tx.get(db.collection("persons").where("phone", "==", profile.phone));
      const pending = await tx.get(db.collection("unverifiedPersons").where("phone", "==", profile.phone));
      if (!matching.empty || !pending.empty) throw new ApiError(409, "guest-conflict");
      const stamp = Timestamp.now();
      tx.set(ref, { ...profile, registrationFingerprint: digest, type: "guest", status: null,
        membershipExpiry: null, rfidTagId: null, joinDate: null, visitCount: 0, lastVisitAt: null,
        createdAt: stamp, updatedAt: stamp });
      tx.set(db.doc(`unverifiedAttendanceState/${personId}`), { openLogId: null, lastAction: null,
        lastLogId: null, lastAcceptedScanAt: null, updatedAt: stamp });
      appendAudit(tx, db, { actorId: `customer:${personId}`, action: "registration-created",
        entityType: "unverifiedPerson", entityId: personId, personId, operationId,
        after: { type: "guest", rateCategory: profile.rateCategory } });
    });
    return json({ personId });
  }, "registration");
}
