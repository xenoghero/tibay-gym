import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type FirestoreDataConverter,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { adminMutation } from "@/lib/admin-api";

// Private companion data for a Person. The document id is the person id so
// optional demographics stay outside the publicly readable Person document.

export const PROFILE_DETAILS_COLLECTION = "profileDetails";

export interface ProfileDetails {
  /** One-to-one key; equal to both this document's id and Person.id. */
  personId: string;
  /** Optional source of truth for derived age; age is never stored. */
  birthDate: Timestamp | null;
  /** Optional free-form address. */
  address: string | null;
  updatedAt: Timestamp;
}

export type ProfileDetailsDoc = ProfileDetails;

export const profileDetailsConverter: FirestoreDataConverter<
  ProfileDetails,
  ProfileDetailsDoc
> = {
  toFirestore(details: WithFieldValue<ProfileDetails>) {
    return details as ProfileDetailsDoc;
  },
  fromFirestore(snapshot, options): ProfileDetails {
    const data = snapshot.data(options) as Partial<ProfileDetailsDoc>;
    return {
      personId: data.personId ?? snapshot.id,
      birthDate: data.birthDate ?? null,
      address: data.address ?? null,
      updatedAt: data.updatedAt!,
    };
  },
};

export const profileDetailsCollection = (): CollectionReference<
  ProfileDetails,
  ProfileDetailsDoc
> =>
  collection(db, PROFILE_DETAILS_COLLECTION).withConverter(
    profileDetailsConverter,
  );

export const profileDetailsDoc = (
  personId: string,
): DocumentReference<ProfileDetails, ProfileDetailsDoc> =>
  doc(db, PROFILE_DETAILS_COLLECTION, personId).withConverter(
    profileDetailsConverter,
  );

/**
 * Reads the optional companion document. `null` is a valid compatibility
 * state for every profile created before private details existed; callers do
 * not need to migrate old Person documents before rendering them.
 */
export async function getProfileDetails(
  personId: string,
): Promise<ProfileDetails | null> {
  const snap = await getDoc(profileDetailsDoc(personId));
  return snap.exists() ? snap.data() : null;
}

export interface ProfileDetailsInput {
  birthDate: Timestamp | null;
  address: string | null;
}

/**
 * Builds the raw document body used by both the standalone and batched admin
 * writes. `serverTimestamp()` is intentionally kept here so callers cannot
 * accidentally write a resolved client clock value into `updatedAt`.
 */
export function profileDetailsWriteData(
  personId: string,
  input: ProfileDetailsInput,
) {
  return {
    personId,
    birthDate: input.birthDate,
    address: input.address?.trim() || null,
    updatedAt: serverTimestamp(),
  };
}

/**
 * Builds the deliberately smaller document body allowed by the public
 * no-match guest check-in path. Birth date is omitted entirely rather than
 * written as null so the Firestore rule can reject every other private field.
 */
export function publicAddressWriteData(personId: string, address: string) {
  return {
    personId,
    address: address.trim(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Creates or replaces the one-to-one private details document. Writes bypass
 * the converter because `serverTimestamp()` is a write sentinel rather than
 * a resolved `Timestamp`.
 */
export async function upsertProfileDetails(
  personId: string,
  input: ProfileDetailsInput,
): Promise<void> {
  await adminMutation("profile-details", { personId, input });
}

/** Deletes the optional companion document; deleting a missing document is safe. */
export async function deleteProfileDetails(personId: string): Promise<void> {
  await adminMutation("profile-details-delete", { personId });
}
