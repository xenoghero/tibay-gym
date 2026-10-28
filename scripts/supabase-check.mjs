import nextEnv from "@next/env";
import { supabaseAdmin } from "../lib/server/supabase.ts";

nextEnv.loadEnvConfig(process.cwd());

try {
  const client = supabaseAdmin();
  // A read-only database schema request works even before receipt tables exist.
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/`, {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Database API returned HTTP ${response.status}`);
  const schema = await response.json();
  if (!schema.paths) throw new Error("Database API did not return its schema");
  console.log("Supabase database API: connected");

  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(`Storage API returned ${error.status ?? "an error"}`);
  console.log(`Supabase Storage: connected (${data.length} existing buckets)`);
  console.log("Read-only check complete; no tables, files, or buckets were changed.");
} catch (error) {
  // Do not log SDK errors or request headers, which might contain credentials.
  console.error(error instanceof Error && !/sb_secret_|eyJ/.test(error.message)
    ? error.message
    : "Supabase connection check failed");
  process.exitCode = 1;
}
