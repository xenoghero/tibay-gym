import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Private storage server configuration is missing');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = 'profile-photos';
const existing = await client.storage.getBucket(bucket);
if (!existing.data) {
  const created = await client.storage.createBucket(bucket, { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/webp'] });
  if (created.error) throw new Error('Could not create private profile storage');
}
const checked = await client.storage.getBucket(bucket);
if (checked.error || checked.data.public) throw new Error('Profile storage must exist and be private');
console.log('Private profile-photos bucket verified. No public policies or objects were created.');
