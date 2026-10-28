// Pure planning: legacy values require an explicit physical-verification mapping.
export function planMigration(persons, cards, logs, verified = {}) {
  const issues = [];
  const bindings = new Map();
  const people = new Map(persons.map(p => [p.id, p]));
  for (const p of persons) {
    if (p.deletingAt) { issues.push(`deleting-person:${p.id}`); continue; }
    if (p.rfidTagId == null) continue;
    const uid = Object.hasOwn(verified, p.rfidTagId) ? verified[p.rfidTagId] : null;
    if (typeof uid !== 'string' || !/^(?:[0-9A-F]{2}:){3}[0-9A-F]{2}$/.test(uid)) {
      issues.push(`unverified-card:${p.id}`); continue;
    }
    if (bindings.has(uid)) issues.push(`duplicate-card:${p.id}:${bindings.get(uid)}`);
    else bindings.set(uid, p.id);
  }
  for (const c of cards) if (bindings.get(c.id) !== c.personId) issues.push(`registry-conflict:${c.id}`);
  const sessions = persons.map(p => {
    const own = logs.filter(l => l.personId === p.id);
    for (const l of own) if (!Number.isFinite(l.checkInAt?.toMillis?.()) ||
      (l.checkOutAt !== null && !Number.isFinite(l.checkOutAt?.toMillis?.()))) issues.push(`invalid-log:${l.id}`);
    const open = own.filter(l => l.checkOutAt === null).sort((a, b) =>
      (b.checkInAt?.toMillis?.() ?? 0) - (a.checkInAt?.toMillis?.() ?? 0) || a.id.localeCompare(b.id));
    return { personId: p.id, openLogId: open[0]?.id ?? null,
      close: open.slice(1).map(l => ({ id: l.id, at: open[0].checkInAt })) };
  });
  for (const l of logs) if (!people.has(l.personId)) issues.push(`orphan-log:${l.id}`);
  return { issues, bindings: [...bindings].map(([uid, personId]) => ({ uid, personId })), sessions };
}
