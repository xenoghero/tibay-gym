// TASKLIST Phase 6 — the entrance-poster QR target. Deliberately not editable
// from the app (no input field, no settings row): the URL is derived here and
// nowhere else.

/** Path of the public check-in page the QR poster points at (Phase 4). */
export const CHECKIN_PATH = "/checkin";

/** Gym name shown on the printed poster caption. */
export const GYM_NAME = "Tibay Gym";

/**
 * Absolute URL the entrance-poster QR encodes.
 *
 * Prefers `NEXT_PUBLIC_APP_URL` when set — that is the production origin, filled
 * in once hosting is decided (see TASKLIST "Deployment & Hosting"). Until then it
 * falls back to the current browser origin so the QR is still correct in local
 * dev and preview builds. Returns an empty string during SSR (no `window`); the
 * Print QR view only calls this from an effect, client-side.
 */
export function resolveCheckInUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const origin =
    configured && configured.length > 0
      ? configured
      : typeof window !== "undefined"
        ? window.location.origin
        : "";
  return `${origin}${CHECKIN_PATH}`;
}
