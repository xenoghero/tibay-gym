import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/firebase-admin";
import { ApiError } from "./http";
import { documentId } from "./validation";
import { appendAudit } from "../audit";

/** Idempotent dismissal preserves the diagnostic and original tap timestamp. */
export async function dismissRejectedMemberTap(eventId: string, actorId = "system"): Promise<void> {
  const db = adminDb();
  const ref = db.doc(`rfidTapEvents/${documentId(eventId)}`);
  await db.runTransaction(async (tx) => {
    const event = (await tx.get(ref)).data();
    // Retention/profile cleanup may have already removed the event.
    if (!event) return;
    if (event.resultCode !== "expired-member") throw new ApiError(400, "invalid-alert");
    if (event.dismissedAt == null) {
      tx.update(ref, { dismissedAt: Timestamp.now() });
      appendAudit(tx, db, { actorId, action: "rfid-alert-dismissed", entityType: "rfidTapEvent", entityId: eventId,
        personId: event.personId ?? null, operationId: `dismiss-${eventId}`, after: { status: "dismissed" } });
    }
  });
}
