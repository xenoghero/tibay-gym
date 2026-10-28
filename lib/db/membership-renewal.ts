import type { Timestamp } from "firebase/firestore";
import type { Person } from "./person";
import { adminMutation } from "@/lib/admin-api";

/** The server compares the reviewed membership and appends audit atomically. */
export async function renewMembership(person: Person, expiry: Timestamp): Promise<void> {
  await adminMutation("renew", { personId: person.id, expectedStatus: person.status,
    expectedExpiryMs: person.membershipExpiry?.toMillis() ?? null, expiry });
}
