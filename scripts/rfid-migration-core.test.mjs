import { expect, it } from 'vitest';
import { planMigration } from './rfid-migration-core.mjs';
const stamp = n => ({ toMillis: () => n });
const uid = '09:70:65:20';
it('never guesses even a canonical-looking legacy value', () => {
  expect(planMigration([{ id: 'p', rfidTagId: uid }], [], []).issues).toEqual(['unverified-card:p']);
});
it('detects canonical duplicates and conflicting registry ownership', () => {
  const plan = planMigration([{ id: 'a', rfidTagId: 'old' }, { id: 'b', rfidTagId: uid }],
    [{ id: uid, personId: 'b' }], [], { old: uid, [uid]: uid });
  expect(plan.issues).toContain('duplicate-card:b:a');
  expect(plan.issues).toContain(`registry-conflict:${uid}`);
});
it('keeps latest open row and closes older rows at its opening without changing counters/history', () => {
  const logs = [ { id: 'older', personId: 'p', checkInAt: stamp(1), checkOutAt: null },
    { id: 'newer', personId: 'p', checkInAt: stamp(2), checkOutAt: null } ];
  const plan = planMigration([{ id: 'p', rfidTagId: null }], [], logs);
  expect(plan.issues).toEqual([]);
  expect(plan.sessions[0]).toEqual({ personId: 'p', openLogId: 'newer', close: [{ id: 'older', at: logs[1].checkInAt }] });
  expect(logs[0].checkOutAt).toBeNull();
});
it('blocks malformed dates, orphan visits, unsupported UID lengths and deleting profiles', () => {
  const plan = planMigration([{ id: 'p', rfidTagId: 'bad' }, { id: 'd', deletingAt: stamp(1) }], [],
    [{ id: 'bad', personId: 'p', checkInAt: null, checkOutAt: null },
      { id: 'orphan', personId: 'missing', checkInAt: stamp(1), checkOutAt: null }], { bad: '09:70:65' });
  expect(plan.issues).toEqual(['unverified-card:p', 'deleting-person:d', 'invalid-log:bad', 'orphan-log:orphan']);
});
