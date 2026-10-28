import nextEnv from '@next/env';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { planMigration } from './rfid-migration-core.mjs';

nextEnv.loadEnvConfig(process.cwd());
const [operation, mappingPath, confirmation] = process.argv.slice(2);
if (!['check', 'reconcile', 'cleanup', 'status'].includes(operation))
  throw new Error('Usage: rfid:maintenance check|reconcile [verified-mapping.json] [--writes-paused] | cleanup | status');
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey || projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  throw new Error('Configure matching projects and server-only credentials');
const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }));
const deviceRef = db.doc('rfidDevices/entrance-01');
const now = Timestamp.now();
if (operation === 'cleanup') {
  // Bounded per invocation; rerun until all counts are zero. TTL is the backstop.
  const counts = {};
  for (const name of ['scanResults', 'rfidTapEvents', 'rfidCardChanges', 'rfidRateLimits']) {
    const rows = await db.collection(name).where('retainUntil', '<=', now).limit(400).get();
    // A throttle bucket can be renewed after the query; recheck atomically.
    counts[name] = await db.runTransaction(async tx => {
      const fresh = rows.empty ? [] : await tx.getAll(...rows.docs.map(row => row.ref));
      let deleted = 0;
      for (const row of fresh) if (row.data()?.retainUntil?.toMillis() <= now.toMillis()) {
        tx.delete(row.ref); deleted++;
      }
      return deleted;
    });
  }
  console.log(JSON.stringify({ operation, deleted: counts }));
} else if (operation === 'status') {
  const d = (await db.doc('rfidDeviceStatus/entrance-01').get()).data();
  console.log(JSON.stringify({ enabled: d?.enabled ?? false,
    heartbeatAgeSeconds: d?.lastSeenAt ? (now.toMillis() - d.lastSeenAt.toMillis()) / 1000 : null,
    online: !!d?.enabled && !!d.lastSeenAt && now.toMillis() - d.lastSeenAt.toMillis() < 180000 }));
} else {
  const verified = mappingPath ? JSON.parse(await readFile(mappingPath, 'utf8')) : {};
  const readRows = async name => (await db.collection(name).get()).docs.map(d => ({ ...d.data(), id: d.id }));
  const [persons, cards, logs] = await Promise.all(['persons', 'rfidCards', 'attendanceLogs'].map(readRows));
  const plan = planMigration(persons, cards, logs, verified);
  console.log(JSON.stringify({ operation, persons: persons.length, cards: plan.bindings.length,
    guards: plan.sessions.length, duplicateOpenRows: plan.sessions.reduce((n, s) => n + s.close.length, 0), issues: plan.issues }));
  if (plan.issues.length) process.exitCode = 1;
  else if (operation === 'reconcile') {
    if (confirmation !== '--writes-paused') throw new Error('Pause all attendance/profile writers and pass --writes-paused');
    // Each person is atomic and repeatable. Production execution belongs to cutover.
    for (const session of plan.sessions) await db.runTransaction(async tx => {
      const device = (await tx.get(deviceRef)).data();
      if (device?.enabled || device?.activeAssignmentId) throw new Error('Disable scanner and cancel enrollment first');
      const pRef = db.doc(`persons/${session.personId}`);
      const p = (await tx.get(pRef)).data();
      const rows = await tx.get(db.collection('attendanceLogs').where('personId', '==', session.personId));
      const registry = await tx.get(db.collection('rfidCards'));
      const fresh = planMigration([{ ...p, id: session.personId }], registry.docs.filter(c => c.data().personId === session.personId)
        .map(c => ({ ...c.data(), id: c.id })), rows.docs.map(l => ({ ...l.data(), id: l.id })), verified);
      if (!p || fresh.issues.length || p.deletingAt) throw new Error('Data changed; rerun checks');
      const binding = fresh.bindings[0];
      if (binding && registry.docs.some(c => c.id === binding.uid && c.data().personId !== session.personId)) throw new Error('Card ownership changed');
      if (fresh.sessions[0].close.length > 390) throw new Error('Too many open rows; manually reconcile before retry');
      const stateRef = db.doc(`attendanceState/${session.personId}`);
      const state = (await tx.get(stateRef)).data();
      for (const close of fresh.sessions[0].close) tx.update(db.doc(`attendanceLogs/${close.id}`),
        { checkOutAt: close.at, closedReason: 'manual' });
      if (!state || state.openLogId !== fresh.sessions[0].openLogId || fresh.sessions[0].close.length)
        tx.set(stateRef, { openLogId: fresh.sessions[0].openLogId, lastAcceptedScanAt: null, lastAction: null, lastLogId: null, updatedAt: now });
      if (binding) {
        if (!registry.docs.some(c => c.id === binding.uid)) tx.create(db.doc(`rfidCards/${binding.uid}`),
          { personId: session.personId, assignedAt: now, updatedAt: now, assignedBy: 'migration' });
        if (p.rfidTagId !== binding.uid) tx.update(pRef, { rfidTagId: binding.uid, updatedAt: now });
      }
    });
    console.log('Reconciliation complete. Rerun check with canonical values included in verified mapping.');
  }
}
