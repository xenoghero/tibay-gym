/** Shared display/server policy; expiry at the boundary takes precedence. */
export function effectiveMemberStatusAt(person: {
  type: string;
  status: "active" | "expired" | null;
  membershipExpiry: { toMillis(): number } | null;
}, now: number): "active" | "expired" | null {
  if (person.type !== "member") return null;
  if (person.membershipExpiry && person.membershipExpiry.toMillis() <= now) return "expired";
  return person.status;
}
