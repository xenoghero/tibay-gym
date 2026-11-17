"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { CoachingPackage, CoachingSettings } from "@/lib/coaching/catalog";
import { parsePesoInput } from "@/lib/finance/rules";
import styles from "./settings.module.css";

type Row = { id: string; price: string; sessions: string; validityDays: string; visible: boolean };
const toRow = (p: CoachingPackage): Row => ({ id: p.id, price: String(p.priceMinor / 100), sessions: String(p.sessions), validityDays: String(p.validityDays), visible: p.visible });
const messages: Record<string, string> = {
  "settings-changed": "The catalog changed in another session. Reload before saving.",
  "coaching-package-delete-forbidden": "Packages can't be deleted. Hide them instead.",
  "invalid-coaching-packages": "Check each package: price, sessions and validity days must be positive whole numbers.",
};

export function CoachingCatalogSettings() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<CoachingSettings | null>(null), [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken().then(token => fetch("/api/admin/coaching", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: CoachingSettings = await response.json();
        if (active) { setSaved(data); setRows(data.packages.map(toRow)); setError(""); }
      }).catch(() => { if (active) setError("Could not load the coaching catalog. Reload to try again."); });
    return () => { active = false; };
  }, [user, reload]);
  const update = (index: number, change: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...change } : row));

  async function save() {
    if (!user || !saved || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const packages = rows.map(row => ({ id: row.id, priceMinor: parsePesoInput(row.price) ?? 0, sessions: Number(row.sessions), validityDays: Number(row.validityDays), visible: row.visible }));
      const response = await fetch("/api/admin/coaching", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ revision: saved.revision, packages }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messages[result.error] ?? "Could not confirm the change. Reload to check the saved catalog.");
      setSaved(result); setRows(result.packages.map(toRow)); setMessage("Coaching catalog saved. Changes apply to new purchases only.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the catalog."); }
    finally { setBusy(false); }
  }
  function add() {
    const taken = new Set(rows.map(row => row.id));
    let n = rows.length + 1; while (taken.has(`pkg-custom-${n}`)) n++;
    setRows([...rows, { id: `pkg-custom-${n}`, price: "", sessions: "", validityDays: "", visible: false }]);
  }

  return <section className={styles.section} aria-labelledby="coaching-catalog-title">
    <div className={styles.head}><div>
      <h2 id="coaching-catalog-title">Coaching packages</h2>
      <p className={styles.sub}>One price for every rate category. Each package includes one month of gym membership. Edits apply to new purchases only; hide a package instead of deleting it.</p>
    </div></div>
    {!saved && !error && <div className={styles.skeleton} aria-label="Loading coaching catalog" />}
    {saved && <fieldset disabled={busy}>
      <legend>Packages</legend>
      <table className={styles.table}>
        <thead><tr><th scope="col">Price (₱)</th><th scope="col">Sessions</th><th scope="col">Validity (days)</th><th scope="col">Visible</th></tr></thead>
        <tbody>{rows.map((row, i) => <tr key={row.id}>
          <td><input aria-label={`Price for package ${i + 1}`} inputMode="decimal" value={row.price} onChange={e => update(i, { price: e.target.value })} /></td>
          <td><input aria-label={`Sessions for package ${i + 1}`} inputMode="numeric" value={row.sessions} onChange={e => update(i, { sessions: e.target.value })} /></td>
          <td><input aria-label={`Validity days for package ${i + 1}`} inputMode="numeric" value={row.validityDays} onChange={e => update(i, { validityDays: e.target.value })} /></td>
          <td><input type="checkbox" aria-label={`Show package ${i + 1} to customers`} checked={row.visible} onChange={e => update(i, { visible: e.target.checked })} /></td>
        </tr>)}</tbody>
      </table>
      <div className={styles.footer}>
        <button type="button" onClick={add}>Add package</button>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setRows(saved.packages.map(toRow)); setError(""); }}>Discard changes</button>
          <button type="button" className={styles.primary} onClick={() => void save()}>{busy ? "Saving…" : "Save catalog"}</button>
        </div>
      </div>
    </fieldset>}
    <p className={styles.error} role="alert">{error}</p>
    {error && !saved && <button type="button" onClick={() => { setError(""); setReload(v => v + 1); }}>Reload catalog</button>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </section>;
}
