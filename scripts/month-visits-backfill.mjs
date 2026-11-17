import nextEnv from '@next/env';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// One-off: sets `monthVisits` on people with check-ins this gym month, for the People tab.
// Counts are rebuilt from attendanceLogs inside a transaction, so it is idempotent and safe
// to run while the gym is open. Usage: npm run visits:backfill
nextEnv.loadEnvConfig(process.cwd());
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  throw new Error('Configure matching projects and server-only credentials');
const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));

// Same month as lib/month-visits.ts: the Manila calendar.
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date());
const monthStart = Timestamp.fromMillis(Date.parse(`${month}-01T00:00:00+08:00`));
const logs = await db.collection('attendanceLogs').where('checkInAt', '>=', monthStart).select('personId').get();
const personIds = [...new Set(logs.docs.map(doc => doc.get('personId')).filter(id => typeof id === 'string'))];
let updated = 0;
for (const personId of personIds) {
  if (await db.runTransaction(async tx => {
    const ref = db.doc(`persons/${personId}`), person = await tx.get(ref);
    if (!person.exists || person.get('deletingAt') != null) return false;
    // desc matches the existing (personId, checkInAt DESC) index.
    const visits = await tx.get(db.collection('attendanceLogs').where('personId', '==', personId)
      .where('checkInAt', '>=', monthStart).orderBy('checkInAt', 'desc').select());
    tx.update(ref, { monthVisits: { month, count: visits.size } });
    return true;
  })) updated++;
}
console.log(`${month}: set monthVisits on ${updated} of ${personIds.length} people with check-ins`);
