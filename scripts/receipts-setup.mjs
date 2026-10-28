import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Missing private Supabase server configuration');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = await supabase.storage.getBucket('payment-receipts');
if (!bucket.data) {
  const created = await supabase.storage.createBucket('payment-receipts', { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/webp'] });
  if (created.error) throw new Error('Could not create private receipt bucket');
} else if (bucket.data.public) throw new Error('Receipt bucket must be private');
if (process.argv.includes('--apply')) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Set server-only SUPABASE_DB_URL to apply the saved migration, or run it in the project SQL Editor');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  try { await client.connect(); await client.query(await readFile(new URL('../supabase/migrations/202610250001_private_receipts.sql', import.meta.url), 'utf8')); }
  catch { throw new Error('Receipt migration did not complete; verify the database connection and migration in the SQL Editor'); }
  finally { await client.end(); }
}
const ready = await supabase.rpc('tibay_receipt_ready');
if (ready.error || ready.data !== true) throw new Error('Private receipt schema/security is not ready. Apply supabase/migrations/202610250001_private_receipts.sql in the project SQL Editor or set SUPABASE_DB_URL and rerun with --apply. GCash remains disabled.');
console.log('Private receipt bucket, schema and access gate verified.');
