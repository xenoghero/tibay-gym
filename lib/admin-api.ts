import { auth } from "./firebase";
// Keep uncertain requests stable across retries in this tab. Clear only after a definite outcome.
const attempts = new Map<string, string>();
function encode(value: unknown): unknown {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return { $timestamp: value.toMillis() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
export async function adminMutation<T = void>(action: string, payload: Record<string, unknown>): Promise<T> {
  const input = encode(payload) as Record<string, unknown>;
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to continue.");
  const key = JSON.stringify([auth.currentUser?.uid, action, input]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const storageKey = `tibay-operation-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  let stored: string | null = null;
  try { stored = sessionStorage.getItem(storageKey); } catch { /* Memory fallback when browser storage is unavailable. */ }
  const operationId = attempts.get(key) ?? stored ?? crypto.randomUUID();
  attempts.set(key, operationId);
  try { sessionStorage.setItem(storageKey, operationId); } catch { /* Memory fallback. */ }
  function clearAttempt() { attempts.delete(key); try { sessionStorage.removeItem(storageKey); } catch { /* Memory fallback. */ } }
  let response: Response;
  try { response = await fetch("/api/admin/mutate", { method: "POST", headers: {
    "Content-Type": "application/json", Authorization: `Bearer ${token}`,
  }, body: JSON.stringify({ action, ...input, operationId }), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("Could not confirm the change. Retry the same action to recover it safely."); }
  const result = await response.json();
  if (response.ok) { clearAttempt(); return result as T; }
  if (response.status < 500) clearAttempt();
  const messages: Record<string, string> = {
    "purchase-review-required": "Use the membership purchase and payment-review workflow for this change.",
    "membership-correction-reason-required": "Enter a reason for the manual membership date/status correction.",
    "purchase-quote-changed": "The purchase quote changed. Refresh pricing and coverage before submitting again.",
    "monthly-price-or-category-unset": "Set the customer's category and applicable monthly rate before submitting a membership purchase.",
    "membership-changed": "Membership changed while you were reviewing it. Reload and check the dates.",
    "person-unavailable": "This profile is no longer available.",
    "invalid-expiry": "Choose a future expiry later than the current expiry.",
    "phone-conflict": "A profile already uses this phone number.",
  };
  throw new Error(messages[result.error] ?? "Could not save the change. Refresh the record, check the values, and retry.");
}
