import type { User } from "firebase/auth";

/** The coach profile when the signed-in user is an active coach, otherwise null. */
export async function coachProfile(user: User): Promise<{ id: string; name: string; email: string } | null> {
  const response = await fetch("/api/coach/me", { cache: "no-store", headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
  return response.ok ? response.json() : null;
}

/** Where the shared login sends a signed-in staff member. Admin access is still enforced server-side. */
export async function staffHome(user: User): Promise<"/coach" | "/dashboard"> {
  try { return (await coachProfile(user)) ? "/coach" : "/dashboard"; }
  catch { return "/dashboard"; }
}
