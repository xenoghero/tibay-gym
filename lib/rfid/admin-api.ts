import { auth } from "@/lib/firebase";

const messages: Record<string, string> = {
  "scanner-offline": "Scanner is offline. Reconnect it, then try again. QR attendance remains available.",
  "device-not-provisioned": "Scanner is not ready. Ask the system manager to set it up.",
  "enrollment-active": "Another enrollment is active. Review the shared request below before trying again.",
  "binding-changed": "This person’s card changed in another tab. Review the current card and try again.",
  "card-owned": "This card belongs to another person. Enrollment ended. Start Assign Card or Replace Card again to try an available card, or remove this card from its owner’s profile first.",
  "registry-conflict": "Card records need attention. Ask the system manager to check this binding.",
  "person-unavailable": "This profile is being removed or is no longer available.",
  "invalid-uid": "The scanner sent an unsupported card UID. Tap a supported card.",
  "replace-required": "This person already has a different card. Cancel and choose Replace Card.",
  "no-card-assigned": "No card is currently assigned. Review the profile and choose Assign Card.",
  "admin-required": "Sign in again with the admin account to continue.",
  "unauthorized": "Sign in again to continue.",
};

export function cardError(code: string): string {
  return messages[code] ?? "Could not confirm the card action. Check your connection and review the current request before retrying.";
}

export async function rfidAdminApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to manage cards.");
  const response = await fetch(path, { method, cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(cardError(data.error));
  return data as T;
}

export interface AssignmentStatus {
  id: string; personId: string; operation: "assign" | "replace";
  status: "pending" | "completed" | "cancelled" | "expired";
  expiresAt: number; capturedUid: string | null; lastErrorCode: string | null;
}
export interface CardStatus {
  uid: string | null; unavailable: boolean; scanner: { online: boolean };
  active: (AssignmentStatus & { personName: string }) | null;
  latest: AssignmentStatus | null;
}
