import { expect, it, vi } from "vitest";
import { Timestamp } from "firebase/firestore";
import type { Person } from "./person";
const mutation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-api", () => ({ adminMutation: mutation }));
import { renewMembership } from "./membership-renewal";
it("sends the reviewed membership to the protected transaction", async () => {
  const expiry = Timestamp.fromMillis(1800000000000);
  const person = { id: "p1", status: "expired", membershipExpiry: Timestamp.fromMillis(1700000000000) } as Person;
  await renewMembership(person, expiry);
  expect(mutation).toHaveBeenCalledWith("renew", { personId: "p1", expectedStatus: "expired", expectedExpiryMs: 1700000000000, expiry });
});
