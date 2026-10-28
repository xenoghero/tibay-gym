// Check the import with require(ESM) disabled to mirror runtimes where
// Firebase Admin 14 -> jwks-rsa 4 -> jose 6 failed at module load time.
const { spawnSync } = require('node:child_process');
const check = spawnSync(process.execPath, [
  '--no-experimental-require-module',
  '-e',
  "require('firebase-admin/auth')",
], { encoding: 'utf8' });

if (check.status !== 0) {
  console.error('Firebase Admin Auth cannot load without require(ESM).');
  console.error(check.stderr.trim());
  process.exit(1);
}
