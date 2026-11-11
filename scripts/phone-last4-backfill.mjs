import nextEnv from '@next/env';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// One-off: sets `phoneLast4` on existing people so 4-digit check-in can find them.
// Idempotent; safe to rerun. Usage: npm run phone:backfill
nextEnv.loadEnvConfig(process.cwd());
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\n/g, '\n');
if (!projectId || !clientEmail || !privateKey || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  throw new Error('Configure matching projects and server-only credentials');
const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));

for (const name of ['persons', 'unverifiedPersons']) {
  let updated = 0, last;
  for (;;) {
    let query = db.collection(name).orderBy('__name__').limit(400);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    const batch = db.batch();
    for (const doc of page.docs) {
      const phone = doc.get('phone');
      if (typeof phone === 'string' && /^\d{11}$/.test(phone) && doc.get('phoneLast4') !== phone.slice(-4)) {
        batch.update(doc.ref, { phoneLast4: phone.slice(-4) }); updated++;
      }
    }
    await batch.commit();
    last = page.docs.at(-1);
  }
  console.log(`${name}: updated ${updated}`);
}
