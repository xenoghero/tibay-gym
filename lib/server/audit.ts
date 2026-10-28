import "server-only";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";

export interface AuditEvent {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  personId: string | null;
  occurredAt: number;
  operationId: string;
  relevantBefore: Record<string, unknown> | null;
  relevantAfter: Record<string, unknown> | null;
  reason: string | null;
}
// Explicit allowlist: no contact data, credentials, tokens, image paths or receipt contents.
const allowed = new Set(["type", "status", "membershipExpiry", "joinDate", "rateCategory", "visitCount", "lastVisitAt",
  "checkOutAt", "checkInAt", "closedReason", "enabled", "label", "studentDailyMinor", "regularDailyMinor",
  "studentMonthlyMinor", "regularMonthlyMinor", "rateRevision", "financialCutoverAt", "deleted", "changedFields", "assigned", "weightEntryCount", "amountMinor", "method", "kind", "normalizedReference", "ocrStatus",
  "disputeHold", "legalHold", "filingDeadline", "filedAt", "accountingDeleteAfter"]);
export function auditValues(input: Record<string, unknown> | undefined | null) {
  if (!input) return null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") result[key] = value.toMillis();
    else if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") result[key] = value;
    else if (key === "changedFields" && Array.isArray(value)) result[key] = value.filter(item => typeof item === "string");
  }
  return result;
}
export function appendAudit(tx: Transaction, db: Firestore, event: Omit<AuditEvent, "occurredAt" | "relevantBefore" | "relevantAfter" | "reason"> & {
  before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string | null; occurredAt?: number;
}) {
  const { before, after, ...rest } = event;
  const id = createHash("sha256").update(JSON.stringify([event.operationId, event.action, event.entityType, event.entityId])).digest("hex");
  // IDs are stable per logical mutation; callers must deduplicate the mutation in the same transaction.
  tx.set(db.doc(`auditEvents/${id}`), { ...rest, occurredAt: event.occurredAt ?? Date.now(),
    relevantBefore: auditValues(before), relevantAfter: auditValues(after), reason: event.reason ?? null } satisfies AuditEvent);
}
