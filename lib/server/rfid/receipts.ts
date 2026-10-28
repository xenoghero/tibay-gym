import "server-only";
import { createHash } from "node:crypto";
import { Timestamp, type Transaction, type Firestore } from "firebase-admin/firestore";
import type { ScanResult } from "@/lib/rfid/models";
import { ApiError } from "./http";
import { receiptId } from "./validation";

export const ATTENDANCE_RETRY_MS = 30_000;
export const ENROLLMENT_RECOVERY_MS = 600_000;
export const RECEIPT_RETENTION_MS = 7 * 86_400_000;
export interface EventIdentity { origin: string; eventId: string; requestedAt: number }
export const fingerprint = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** Read before command deadline checks: committed enrollment can outlive its command. */
export async function readReceipt(tx: Transaction, db: Firestore, identity: EventIdentity,
  requestFingerprint: string, now: number, recoveryMs = ATTENDANCE_RETRY_MS) {
  const ref = db.doc(`scanResults/${receiptId(identity.origin, identity.eventId)}`);
  const existing = (await tx.get(ref)).data() as ScanResult | undefined;
  if (existing && existing.requestFingerprint !== requestFingerprint) throw new ApiError(409, "event-id-conflict");
  if (!Number.isSafeInteger(identity.requestedAt) || identity.requestedAt > now + 5_000 ||
      now - identity.requestedAt > recoveryMs || (existing && existing.retainUntil.toMillis() <= now)) {
    throw new ApiError(409, "retry-expired");
  }
  return { ref, existing };
}

export function makeReceipt(identity: EventIdentity, requestFingerprint: string, now: number,
  result: Pick<ScanResult, "resultCode" | "action" | "logId" | "personId" | "assignmentId">): ScanResult {
  return { ...identity, requestedAt: Timestamp.fromMillis(identity.requestedAt), requestFingerprint,
    ...result, processedAt: Timestamp.fromMillis(now), retainUntil: Timestamp.fromMillis(now + RECEIPT_RETENTION_MS) };
}
