import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
  type CollectionReference,
  type DocumentReference,
  type FirestoreDataConverter,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getPerson, type MemberStatus } from "@/lib/db/person";
import { adminMutation } from "@/lib/admin-api";

// Data model: project-plan.md §5. Separate, APPEND-ONLY audit trail for every
// manual status override. Kept off `Person` so overrides don't overwrite
// history on a single field and don't trigger `Person` listeners. The
// per-person "why was this status changed" view queries this by `personId`.

export const STATUS_CHANGE_COLLECTION = "statusChanges";

/** Shape as read back from Firestore (`id` injected from the doc id). */
export interface StatusChange {
  id: string;
  personId: string;
  fromStatus: MemberStatus | null;
  toStatus: MemberStatus;
  /** Required free text entered by the admin (e.g. "Comp", "Freeze", "Renewal"). */
  reason: string;
  changedAt: Timestamp;
}

/** Stored document body — everything except the synthetic `id`. */
export type StatusChangeDoc = Omit<StatusChange, "id">;

export const statusChangeConverter: FirestoreDataConverter<
  StatusChange,
  StatusChangeDoc
> = {
  toFirestore(change: WithFieldValue<StatusChange>) {
    const { id, ...rest } = change as StatusChange;
    return rest;
  },
  fromFirestore(snapshot, options): StatusChange {
    const data = snapshot.data(options) as StatusChangeDoc;
    return { id: snapshot.id, ...data };
  },
};

export const statusChangesCollection = (): CollectionReference<
  StatusChange,
  StatusChangeDoc
> => collection(db, STATUS_CHANGE_COLLECTION).withConverter(statusChangeConverter);

export const statusChangeDoc = (
  id: string,
): DocumentReference<StatusChange, StatusChangeDoc> =>
  doc(db, STATUS_CHANGE_COLLECTION, id).withConverter(statusChangeConverter);

/**
 * Applies a manual status override: appends one `StatusChange` audit row and
 * flips `Person.status` in a single atomic batch. `reason` must be non-blank —
 * callers validate that before reaching here. Independent of the stored
 * `membershipExpiry`, which is left untouched.
 */
export async function overrideMemberStatus(params: {
  personId: string;
  fromStatus: MemberStatus;
  toStatus: MemberStatus;
  reason: string;
}): Promise<void> {
  const person = await getPerson(params.personId);
  if (!person) throw new Error("This profile no longer exists.");
  await adminMutation("status", { personId: params.personId, expectedStatus: person.status,
    expectedExpiryMs: person.membershipExpiry?.toMillis() ?? null, toStatus: params.toStatus, reason: params.reason });
}

/**
 * Deletes every `statusChanges` audit row for one person, in ≤500-doc batches
 * (TASKLIST Phase 8 delete-cascade). Called by `deletePerson` so a removed
 * profile does not retain its private status-audit rows. Equality-only query —
 * no composite index needed. Admin-only in `firestore.rules`; `update` stays
 * closed to everyone.
 * Not one transaction: a batch that fails partway is cleared by re-running.
 * Returns the number of rows deleted.
 */
export async function deleteAllStatusChangesForPerson(
  personId: string,
): Promise<number> {
  return (await adminMutation<{ count: number }>("status-delete-all", { personId })).count;
}

/** Every override for one person, newest first. */
export async function getStatusChangesForPerson(
  personId: string,
): Promise<StatusChange[]> {
  const snap = await getDocs(
    query(
      statusChangesCollection(),
      where("personId", "==", personId),
      orderBy("changedAt", "desc"),
    ),
  );
  return snap.docs.map((d) => d.data());
}
