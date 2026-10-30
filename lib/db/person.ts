import { attendanceApi } from "@/lib/attendance-api";
import { adminMutation } from "@/lib/admin-api";
import type { RateCategory, LeadSource } from "@/lib/finance/contracts";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type CollectionReference,
  type DocumentReference,
  type FirestoreDataConverter,
  type Unsubscribe,
  type WithFieldValue,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { effectiveMemberStatusAt } from "@/lib/member-status";
import {
  type ProfileDetailsInput,
} from "@/lib/db/profile-details";

// Official members and guests share this collection, distinguished by `type`.
// Public self-registration stays in unverifiedPersons until admin approval.

export const PERSON_COLLECTION = "persons";

export type PersonType = "member" | "guest";

/** Current standing for a member. `null` for pure guests (no membership). */
export type MemberStatus = "active" | "expired";

/** Shape as read back from Firestore (`id` injected from the doc id). */
export interface Person {
  /** Missing/null on historical records; independent of membership type. */
  rateCategory?: RateCategory | null;
  leadSource?: LeadSource | null;
  leadSourceOther?: string | null;
  profileImagePath?: string | null;
  id: string;
  /** Unique key, used for lookup at every scan. */
  phone: string;
  name: string;
  type: PersonType;
  /** `null` for guests; "active" | "expired" for members. */
  status: MemberStatus | null;
  membershipExpiry: Timestamp | null;
  /** Optional compatibility mirror of canonical registry ownership.
   * Backend-managed; ordinary profile and conversion writes preserve it.
   */
  rfidTagId: string | null;
  /** Server-owned lifecycle guard; missing/null means available. */
  deletingAt?: Timestamp | null;
  /** Set when a person becomes a member. */
  joinDate: Timestamp | null;
  /** Denormalized running count, incremented on every visit. */
  visitCount: number;
  /**
   * Denormalized timestamp of this person's most recent check-in, set
   * alongside `visitCount` by `recordCheckIn`. `null` until their first visit.
   * Backs the People list "last visit" column without scanning `attendanceLogs`
   * (see attendance-log.ts `recordCheckIn`). A person whose only visits predate
   * this field shows "No visits yet" until their next check-in re-populates it.
   */
  lastVisitAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Stored document body — everything except the synthetic `id`. */
export type PersonDoc = Omit<Person, "id">;

export const personConverter: FirestoreDataConverter<Person, PersonDoc> = {
  toFirestore(person: WithFieldValue<Person>) {
    const { id, ...rest } = person as Person;
    return rest;
  },
  fromFirestore(snapshot, options): Person {
    const data = snapshot.data(options) as PersonDoc;
    return { id: snapshot.id, ...data };
  },
};

export const personsCollection = (): CollectionReference<Person, PersonDoc> =>
  collection(db, PERSON_COLLECTION).withConverter(personConverter);

export const personDoc = (id: string): DocumentReference<Person, PersonDoc> =>
  doc(db, PERSON_COLLECTION, id).withConverter(personConverter);

/**
 * Display-time member standing, computed from `membershipExpiry` rather than
 * trusted from the stored `status` field. `status` only flips via an explicit
 * `StatusChange` (admin override) or a Guest → Member conversion — nothing
 * auto-flips it the instant `membershipExpiry` passes, so a member whose date
 * has lapsed can otherwise show "Active" on the Overview tiles, People badges,
 * and Person Profile while only the Statistics Membership Expiry Watch (which
 * reads the raw date) shows the truth. Every display site should call this
 * instead of reading `.status` directly; the stored field itself is still
 * what admin overrides/conversion write and what `StatusChange` tracks.
 */
export function effectiveMemberStatus(
  person: Pick<Person, "type" | "status" | "membershipExpiry">,
): MemberStatus | null {
  return effectiveMemberStatusAt(person, Date.now());
}

// --- Reads -----------------------------------------------------------------

/** Single person by doc id, or `null` if it doesn't exist. */
export async function getPerson(id: string): Promise<Person | null> {
  const snap = await getDoc(personDoc(id));
  return snap.exists() ? snap.data() : null;
}

/**
 * First person whose stored `phone` matches exactly. Callers should pass an
 * already-trimmed value. `phone` is the uniqueness key across the whole
 * collection, so at most one match is expected.
 */
export async function findPersonByPhone(phone: string): Promise<Person | null> {
  const snap = await getDocs(
    query(personsCollection(), where("phone", "==", phone), limit(1)),
  );
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * First person the given RFID tag is assigned to. Used to block a save that
 * would assign one tag to two profiles.
 */
export async function findPersonByRfidTag(
  rfidTagId: string,
): Promise<Person | null> {
  const snap = await getDocs(
    query(personsCollection(), where("rfidTagId", "==", rfidTagId), limit(1)),
  );
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * One-shot read of the whole `persons` collection. The People tab (TASKLIST
 * Phase 8) also rides the live `watchAllPersons` listener for the roster; this
 * exists for callers that just need a snapshot without a subscription.
 */
export async function listPersons(): Promise<Person[]> {
  const snap = await getDocs(personsCollection());
  return snap.docs.map((d) => d.data());
}

/**
 * Live listener over the whole `persons` collection, newest snapshot wins.
 * At a single gym this collection is small (hundreds of docs), so the Overview
 * tab keeps one listener on all of it and derives both the member active/expired
 * standing counts and the name/phone/type/status lookup its activity feed needs
 * client-side, rather than running a query per feed row. Returns the Firestore
 * `Unsubscribe`.
 */
export function watchAllPersons(
  onNext: (people: Person[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    personsCollection(),
    (snap) => onNext(snap.docs.map((d) => d.data())),
    (err) => onError?.(err),
  );
}

/**
 * Live listener on a single person doc. Used by the Guest → Member conversion
 * page's already-member guard so two staff opening the same guest's convert
 * page at once both see the conversion the moment either one saves, instead
 * of only catching it on page load.
 */
export function watchPerson(
  id: string,
  onNext: (person: Person | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    personDoc(id),
    (snap) => onNext(snap.exists() ? snap.data() : null),
    (err) => onError?.(err),
  );
}

// --- Writes --------------------------------------------------------------
// Writes bypass the converter: `Person` requires the synthetic `id`, which
// doesn't exist yet on create, and `serverTimestamp()` isn't a `Timestamp`.

/** Fields the admin supplies when creating or editing a profile. */
export interface PersonInput {
  rateCategory?: RateCategory | null;
  leadSource?: LeadSource | null;
  leadSourceOther?: string | null;
  phone: string;
  name: string;
  type: PersonType;
  /** `null` for guests; "active" | "expired" for members. */
  status: MemberStatus | null;
  membershipExpiry: Timestamp | null;
  rfidTagId?: string | null;
  joinDate: Timestamp | null;
}

/** Creates a person doc with `visitCount: 0` and server timestamps. Returns the new id. */
export async function createPerson(input: PersonInput): Promise<string> {
  return (await adminMutation<{ id: string }>("profile-create", { input })).id;
}

/**
 * Creates a Person and its private companion document in one atomic admin
 * batch. This is separate from `createPerson` because the public QR guest
 * path must continue writing only the public Person shape.
 */
export async function createPersonWithProfileDetails(
  input: PersonInput,
  profileDetails: ProfileDetailsInput,
  financial?: { quoteToken: string; voucherCode?: string },
): Promise<string> {
  return (await adminMutation<{ id: string }>("profile-create", { input, details: profileDetails, ...(financial ? { financial } : {}) })).id;
}

/** Overwrites the editable profile fields and bumps `updatedAt`. */
export async function updatePerson(
  id: string,
  input: PersonInput,
): Promise<void> {
  await adminMutation("profile-update", { personId: id, input });
}

/** Updates a Person and replaces its private companion in one atomic batch. */
export async function updatePersonWithProfileDetails(
  id: string,
  input: PersonInput,
  profileDetails: ProfileDetailsInput,
  membershipCorrectionReason?: string,
): Promise<void> {
  await adminMutation("profile-update", { personId: id, input, details: profileDetails, ...(membershipCorrectionReason ? { membershipCorrectionReason } : {}) });
}

/** Membership fields collected on the Guest → Member conversion form. */
export interface ConvertToMemberInput {
  status: MemberStatus;
  membershipExpiry: Timestamp | null;
  rfidTagId?: string | null;
  joinDate: Timestamp | null;
}

/**
 * Upgrades an existing guest in place (TASKLIST Phase 9): merges the new
 * membership fields onto the same document via `updateDoc`, never `addDoc`,
 * so `phone`, `name`, `visitCount`, `createdAt`, and every prior
 * `AttendanceLog` row stay attached to the same person id — no duplicate
 * record, no lost history. The companion `ProfileDetails/{id}` document is
 * deliberately untouched, so any saved birth date and address survive the
 * upgrade as well.
 */
export async function convertGuestToMember(
  id: string,
  input: ConvertToMemberInput,
): Promise<void> {
  await adminMutation("convert", { personId: id, input });
}

/**
 * Reverses a just-applied Guest → Member conversion (TASKLIST UX Gap Audit —
 * "no undo path if the wrong guest was matched/converted"). Clears the
 * membership fields `convertGuestToMember` set and flips `type` back to
 * "guest", on the same doc — `phone`/`name`/`visitCount`/history are
 * untouched either way. Intended for the short window right after a
 * conversion, before the admin has acted further on the new membership.
 */
export async function revertGuestConversion(id: string): Promise<void> {
  await adminMutation("revert-conversion", { personId: id });
}

/**
 * Members whose `membershipExpiry` falls on/before `thresholdDays` from now
 * (TASKLIST Phase 10 — Membership Expiry Watch), soonest/most-overdue first.
 * Driven by the raw stored date, not `status` — already-expired members
 * always show up here regardless of the threshold, since their expiry date
 * is necessarily before the cutoff too (statistics-tab-content.md §2). A
 * comped/frozen member whose date has technically lapsed still appears, with
 * `status` alongside for context. One-shot: this tab queries on load/threshold
 * change, not a live listener. Needs a composite index (`type` + `membershipExpiry`).
 */
export async function getMembershipExpiryWatch(
  thresholdDays: number,
): Promise<Person[]> {
  const cutoff = Timestamp.fromMillis(
    Date.now() + thresholdDays * 24 * 60 * 60 * 1000,
  );
  const snap = await getDocs(
    query(
      personsCollection(),
      where("type", "==", "member"),
      where("membershipExpiry", "<=", cutoff),
      orderBy("membershipExpiry", "asc"),
    ),
  );
  return snap.docs.map((d) => d.data());
}

/**
 * Hard-deletes a person and all data owned by their profile (destructive,
 * admin-confirmed). Removes attendance logs, the optional ProfileDetails, all
 * WeightEntry rows, and status-audit rows before deleting the Person document.
 *
 * This is not one atomic transaction: child rows go in bounded commits and the
 * Person doc is deleted last, so a failure leaves the profile visibly present
 * and the deletion can be retried to clear any remaining child rows.
 */
export async function deletePerson(id: string): Promise<void> {
  await attendanceApi("/api/attendance/admin", { operation: "delete-profile", personId: id }, true);
}
