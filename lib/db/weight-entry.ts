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
import { adminMutation } from "@/lib/admin-api";

// Weight is a private time series separate from Person so editing a current
// value never overwrites historical measurements.

export const WEIGHT_ENTRY_COLLECTION = "weightEntries";

export interface WeightEntry {
  id: string;
  personId: string;
  weightKg: number;
  measuredAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type WeightEntryDoc = Omit<WeightEntry, "id">;

export const weightEntryConverter: FirestoreDataConverter<
  WeightEntry,
  WeightEntryDoc
> = {
  toFirestore(entry: WithFieldValue<WeightEntry>) {
    const { id, ...rest } = entry as WeightEntry;
    return rest;
  },
  fromFirestore(snapshot, options): WeightEntry {
    const data = snapshot.data(options) as WeightEntryDoc;
    return { id: snapshot.id, ...data };
  },
};

export const weightEntriesCollection = (): CollectionReference<
  WeightEntry,
  WeightEntryDoc
> =>
  collection(db, WEIGHT_ENTRY_COLLECTION).withConverter(weightEntryConverter);

export const weightEntryDoc = (
  id: string,
): DocumentReference<WeightEntry, WeightEntryDoc> =>
  doc(db, WEIGHT_ENTRY_COLLECTION, id).withConverter(weightEntryConverter);

/**
 * Normalizes a measurement to the v1 storage contract of 0.1 kg precision.
 * The form will also validate this later, but the database helper keeps an
 * out-of-band caller from writing zero, negative, NaN, or infinite values.
 */
export function normalizeWeightKg(weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error("Weight must be a positive number.");
  }
  const rounded = Number((Math.round(weightKg * 10) / 10).toFixed(1));
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error("Weight must be at least 0.1 kg.");
  }
  return rounded;
}

/**
 * Lists a person's measurements in chronological order. A missing collection
 * or no matching rows returns an empty array, so legacy profiles remain valid
 * without a migration.
 */
export async function listWeightEntries(
  personId: string,
): Promise<WeightEntry[]> {
  const snap = await getDocs(
    query(
      weightEntriesCollection(),
      where("personId", "==", personId),
      orderBy("measuredAt", "asc"),
    ),
  );
  return snap.docs.map((entry) => entry.data());
}

export interface WeightEntryInput {
  weightKg: number;
  measuredAt: Timestamp;
}

/** Creates a private measurement and returns its generated id. */
export async function createWeightEntry(
  personId: string,
  input: WeightEntryInput,
): Promise<string> {
  return (await adminMutation<{ id: string }>("weight-create", { personId, input: { ...input, weightKg: normalizeWeightKg(input.weightKg) } })).id;
}

/** Updates the editable fields of one measurement without changing its owner. */
export async function updateWeightEntry(
  id: string,
  input: WeightEntryInput,
): Promise<void> {
  await adminMutation("weight-update", { id, input: { ...input, weightKg: normalizeWeightKg(input.weightKg) } });
}

/** Deletes one private measurement. */
export async function deleteWeightEntry(id: string): Promise<void> {
  await adminMutation("weight-delete", { id });
}

/**
 * Deletes all measurements belonging to one person in bounded batches. The
 * person deletion path calls this before deleting the Person document; if a
 * batch fails, retrying the same deletion clears the remaining private rows.
 */
export async function deleteAllWeightEntriesForPerson(
  personId: string,
): Promise<number> {
  return (await adminMutation<{ count: number }>("weight-delete-all", { personId })).count;
}
