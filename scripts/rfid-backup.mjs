import nextEnv from '@next/env';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { decodeValue, digest, encodeValue } from './rfid-backup-codec.mjs';

const [operation, archivePath] = process.argv.slice(2);
if (!['backup', 'verify', 'restore-emulator'].includes(operation))
  throw new Error('Usage: npm run rfid:backup -- backup | verify <archive.json> | restore-emulator <archive.json>');

const archiveRoot = process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, 'reshape-rfid-backups');
const insideRepo = path => {
  const rel = relative(process.cwd(), path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

async function loadArchive(path) {
  if (!path) throw new Error('Pass the absolute archive path');
  const target = resolve(path);
  if (insideRepo(target)) throw new Error('Backup archives must stay outside the repository');
  const [bytes, checksum] = await Promise.all([readFile(target), readFile(`${target}.sha256`, 'utf8')]);
  if (digest(bytes) !== checksum.trim()) throw new Error('Backup checksum mismatch');
  const archive = JSON.parse(bytes.toString('utf8'));
  if (archive.format !== 'reshape-firestore-v1' || !archive.projectId || !Array.isArray(archive.documents))
    throw new Error('Invalid backup format');
  const paths = new Set();
  for (const row of archive.documents) {
    if (typeof row.path !== 'string' || row.path.split('/').length % 2 !== 0 || paths.has(row.path))
      throw new Error('Invalid or duplicate document path');
    paths.add(row.path);
  }
  return archive;
}

if (operation === 'verify') {
  const archive = await loadArchive(archivePath);
  console.log(JSON.stringify({ verified: true, projectId: archive.projectId,
    documents: archive.documents.length, exportedAt: archive.exportedAt }));
} else if (operation === 'backup') {
  if (!archiveRoot || insideRepo(archiveRoot)) throw new Error('A private LOCALAPPDATA directory outside the repository is required');
  nextEnv.loadEnvConfig(process.cwd());
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
    throw new Error('Configure matching projects and server-only credentials');
  const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));
  const documents = [];
  async function visitCollections(collections) {
    for (const collection of collections) {
      const rows = await collection.get();
      for (const row of rows.docs) {
        documents.push({ path: row.ref.path, data: encodeValue(row.data()) });
        await visitCollections(await row.ref.listCollections());
      }
    }
  }
  await visitCollections(await db.listCollections());
  documents.sort((a, b) => a.path.localeCompare(b.path));
  const archive = { format: 'reshape-firestore-v1', projectId, exportedAt: new Date().toISOString(), documents };
  const bytes = Buffer.from(JSON.stringify(archive));
  await mkdir(archiveRoot, { recursive: true, mode: 0o700 });
  const target = join(archiveRoot, `firestore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(`${target}.sha256`, `${digest(bytes)}\n`, { flag: 'wx', mode: 0o600 });
  await loadArchive(target);
  console.log(JSON.stringify({ archive: target, projectId, documents: documents.length,
    bytes: bytes.length, checksumVerified: true }));
} else {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^(localhost|127\.0\.0\.1):\d+$/.test(host))
    throw new Error('restore-emulator requires FIRESTORE_EMULATOR_HOST on localhost');
  const archive = await loadArchive(archivePath);
  const db = getFirestore(initializeApp({ projectId: archive.projectId }));
  for (let i = 0; i < archive.documents.length; i += 400) {
    const batch = db.batch();
    for (const row of archive.documents.slice(i, i + 400)) batch.set(db.doc(row.path), decodeValue(row.data, db));
    await batch.commit();
  }
  const restored = [];
  async function visitCollections(collections) {
    for (const collection of collections) {
      const rows = await collection.get();
      for (const row of rows.docs) {
        restored.push({ path: row.ref.path, data: encodeValue(row.data()) });
        await visitCollections(await row.ref.listCollections());
      }
    }
  }
  await visitCollections(await db.listCollections());
  restored.sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(restored) !== JSON.stringify(archive.documents)) throw new Error('Emulator restore does not match archive');
  console.log(JSON.stringify({ restoredAndVerified: true, documents: restored.length, projectId: archive.projectId }));
}
