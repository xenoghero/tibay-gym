import "server-only";
import { createClient } from "@supabase/supabase-js";

// Only call from trusted server code after authorizing the request with Firebase.
// This privileged client bypasses RLS and must never be exposed to the browser.
export function supabaseAdmin() {
  if (process.env.NEXT_PUBLIC_FIREBASE_ISOLATED === "1") {
    throw new Error("Live Supabase access is disabled in isolated development");
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY on the server");
  }

  // Lazy initialization allows builds without live credentials. Firebase remains
  // responsible for app authentication; this client does not maintain a session.
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
