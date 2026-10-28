import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { RfidAssignment } from "@/lib/rfid/models";
import { ApiError } from "./http";

export function documentId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new ApiError(400, "invalid-id");
  }
  return value;
}
export function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new ApiError(400, "invalid-event-id");
  }
  return value;
}
export function canonicalUid(value: unknown): string {
  // Only the four-byte format observed in the Phase 1 handoff is supported.
  if (typeof value !== "string" || !/^[0-9A-F]{2}(?::[0-9A-F]{2}){3}$/.test(value)) {
    throw new ApiError(400, "invalid-uid");
  }
  return value;
}
export function credentialHash(deviceId: string, secret: string): string {
  return createHash("sha256").update(`reshape-rfid-v1\0${deviceId}\0${secret}`).digest("hex");
}
export function credentialMatches(deviceId: string, secret: string, verifier: unknown): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || typeof verifier !== "string" || !/^[a-f0-9]{64}$/.test(verifier)) return false;
  return timingSafeEqual(Buffer.from(credentialHash(deviceId, secret), "hex"), Buffer.from(verifier, "hex"));
}
export function receiptId(origin: string, event: string): string {
  return createHash("sha256").update(JSON.stringify([origin, eventId(event)])).digest("hex");
}
export type Capture = { deviceId: string; uid: string; eventId: string } & (
  { mode: "attendance" } | { mode: "enrollment"; assignmentId: string }
);
export function validateCapture(body: Record<string, unknown>, authenticatedDeviceId: string): Capture {
  const deviceId = documentId(body.deviceId);
  if (deviceId !== authenticatedDeviceId) throw new ApiError(403, "device-mismatch");
  const shared = { deviceId, uid: canonicalUid(body.uid), eventId: eventId(body.eventId) };
  if (body.mode === "attendance" && !Object.hasOwn(body, "assignmentId")) return { ...shared, mode: "attendance" };
  if (body.mode === "enrollment") return { ...shared, mode: "enrollment", assignmentId: documentId(body.assignmentId) };
  throw new ApiError(400, "invalid-mode");
}
// Call with documents read INSIDE the eventual mutation transaction.
export function assertCommandOwnership(assignmentId: string, assignment: RfidAssignment | undefined,
  deviceId: string, activeAssignmentId: string | null, now: number): void {
  if (!assignment || assignment.deviceId !== deviceId || activeAssignmentId !== assignmentId) {
    throw new ApiError(409, "command-mismatch");
  }
  if (assignment.status !== "pending" || assignment.expiresAt.toMillis() <= now) throw new ApiError(409, "command-inactive");
}
export function assertPersonAvailable(person: { deletingAt?: unknown } | undefined): void {
  if (!person || person.deletingAt != null) throw new ApiError(409, "person-unavailable");
}
