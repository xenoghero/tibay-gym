import nextEnv from '@next/env';
import { cert, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase/app';
import { doc, getFirestore, serverTimestamp, setDoc, terminate } from 'firebase/firestore';

nextEnv.loadEnvConfig(process.cwd());
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId || projectId !== process.env.FIREBASE_ADMIN_PROJECT_ID || !process.env.NEXT_PUBLIC_FIREBASE_API_KEY)
  throw new Error('Configure matching browser/server Firebase projects');

const id = `cutover-probe-${randomUUID()}`;
const app = initializeApp({ projectId, apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN });
const db = getFirestore(app);
let unexpectedWrite = false;
try {
  for (const [path, data] of [
    [`persons/${id}`, { phone: '0000000000', name: 'Cutover Rule Probe', type: 'guest', status: null,
      membershipExpiry: null, rfidTagId: null, joinDate: null, visitCount: 0,
      lastVisitAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }],
    [`attendanceLogs/${id}`, { personId: id, source: 'qr', checkInAt: serverTimestamp(),
      checkOutAt: null, closedReason: null }],
  ]) {
    try {
      await setDoc(doc(db, path), data);
      unexpectedWrite = true;
      console.error(`UNEXPECTED browser write allowed: ${path.split('/')[0]}`);
    } catch (error) {
      if (error?.code !== 'permission-denied') throw error;
      console.log(`${path.split('/')[0]}: permission-denied as expected`);
    }
  }
} finally {
  if (unexpectedWrite) {
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) throw new Error('Unexpected test write needs manual cleanup: Admin credentials missing');
    const admin = getAdminFirestore(initializeAdminApp({ credential: cert({ projectId, clientEmail, privateKey }) }));
    await Promise.all([admin.doc(`persons/${id}`).delete(), admin.doc(`attendanceLogs/${id}`).delete()]);
    console.log('Unexpected probe documents removed through Admin SDK');
  }
  await terminate(db);
  await deleteApp(app);
}
if (unexpectedWrite) process.exitCode = 1;
