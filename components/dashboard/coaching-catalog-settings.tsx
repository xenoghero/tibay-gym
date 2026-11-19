"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { CoachingPackage, CoachingSettings } from "@/lib/coaching/catalog";
import { parsePesoInput } from "@/lib/finance/rules";
import { SettingsConfirm } from "./settings-confirm";
import styles from "./settings.module.css";

type Draft = { price: string; sessions: string; validityDays: string; visible: boolean };
type Editing = { kind: "package"; index: number; draft: Draft } | { kind: "topUp"; price: string; days: string };
const messages: Record<string, string> = {
  "settings-changed": "The catalog changed elsewhere and was reloaded. Save again to apply your edit.",
  "coaching-package-delete-forbidden": "Packages can't be deleted. Hide them instead.",
  "invalid-coaching-packages": "Price, sessions and days must be positive whole numbers.",
  "invalid-top-up-settings": "Enter a positive top-up price and a validity of 1 to 366 days.",
};
const peso = (minor: number) => `₱${(minor / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const perSession = (minor: number, sessions: number) => sessions > 0 && minor > 0 ? peso(Math.round(minor / sessions / 100) * 100) : null;

function IconEdit() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>;
}

export function CoachingCatalogSettings({ onSaved }: { onSaved(message: string): void }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<CoachingSettings | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken().then(token => fetch("/api/admin/coaching", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: CoachingSettings = await response.json();
        if (active) setSaved(data);
      }).catch(() => { if (active) setError("Could not load the coaching catalog. Reload to try again."); });
    return () => { active = false; };
  }, [user, reload]);

  async function save(packages: CoachingPackage[], topUpPriceMinor: number, topUpValidityDays: number, done: string) {
    if (!user || !saved || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/coaching", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ revision: saved.revision, packages, topUpPriceMinor, topUpValidityDays }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error === "settings-changed") setReload(v => v + 1);
        throw new Error(messages[result.error] ?? "Could not confirm the change. Reload to check the saved catalog.");
      }
      setSaved(result); setEditing(null); onSaved(done);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the catalog."); }
    finally { setBusy(false); }
  }

  function confirmEdit() {
    if (!saved || !editing) return;
    if (editing.kind === "topUp") {
      void save(saved.packages, parsePesoInput(editing.price) ?? 0, Number(editing.days), "Top-up pricing saved. Applies to new purchases.");
      return;
    }
    const { index, draft } = editing, existing = saved.packages[index];
    const taken = new Set(saved.packages.map(p => p.id));
    let n = saved.packages.length + 1; while (taken.has(`pkg-custom-${n}`)) n++;
    const pkg = { id: existing?.id ?? `pkg-custom-${n}`, priceMinor: parsePesoInput(draft.price) ?? 0, sessions: Number(draft.sessions), validityDays: Number(draft.validityDays), visible: draft.visible };
    const packages = existing ? saved.packages.map((p, i) => i === index ? pkg : p) : [...saved.packages, pkg];
    void save(packages, saved.topUpPriceMinor, saved.topUpValidityDays, `${peso(pkg.priceMinor)} package ${existing ? "saved" : "added"}. Applies to new purchases.`);
  }

  const editPackage = (index: number, p?: CoachingPackage) => setEditing({ kind: "package", index, draft: p
    ? { price: String(p.priceMinor / 100), sessions: String(p.sessions), validityDays: String(p.validityDays), visible: p.visible }
    : { price: "", sessions: "", validityDays: "", visible: false } });
  const setDraft = (change: Partial<Draft>) => setEditing(e => e?.kind === "package" ? { ...e, draft: { ...e.draft, ...change } } : e);
  const draftRate = editing?.kind === "package" ? perSession(parsePesoInput(editing.draft.price) ?? 0, Number(editing.draft.sessions)) : null;

  return <section className={styles.section} aria-labelledby="coaching-catalog-title">
    <div className={styles.head}>
      <div><h2 id="coaching-catalog-title">Packages</h2><p className={styles.sub}>Includes 1 month gym access. Edits apply to new purchases.</p></div>
      {saved && <button type="button" onClick={() => editPackage(saved.packages.length)}>Add package</button>}
    </div>
    {!saved && !error && <div className={styles.skeleton} aria-label="Loading coaching catalog" />}
    {!saved && error && <><p className={styles.error} role="alert">{error}</p><button type="button" onClick={() => { setError(""); setReload(v => v + 1); }}>Reload catalog</button></>}
    {saved && <>
      <ul className={styles.cardList}>{saved.packages.map((p, i) => <li key={p.id} className={styles.itemCard}>
        <div>
          <p className={styles.itemTitle}>{peso(p.priceMinor)}<span className={styles.status} data-status={p.visible ? "available" : undefined}>{p.visible ? "Shown" : "Hidden"}</span></p>
          <p className={styles.itemMeta}>{p.sessions} sessions · {p.validityDays} days{perSession(p.priceMinor, p.sessions) && ` · ${perSession(p.priceMinor, p.sessions)} / session`}</p>
        </div>
        <button type="button" className={styles.iconButton} aria-label={`Edit ${peso(p.priceMinor)} package`} onClick={() => editPackage(i, p)}><IconEdit /></button>
      </li>)}</ul>
      <h3 className={styles.subhead}>Session top-ups</h3>
      <div className={`${styles.itemCard} ${styles.topUpCard}`}>
        <div>
          <p className={styles.itemTitle}>{peso(saved.topUpPriceMinor)}<span className={styles.itemUnit}>/ session</span></p>
          <p className={styles.itemMeta}>Coaching only · {saved.topUpValidityDays} days without a package</p>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Edit session top-ups" onClick={() => setEditing({ kind: "topUp", price: String(saved.topUpPriceMinor / 100), days: String(saved.topUpValidityDays) })}><IconEdit /></button>
      </div>
    </>}

    {editing && <SettingsConfirm sheet busy={busy} onCancel={() => { setEditing(null); setError(""); }} onConfirm={confirmEdit}
      title={editing.kind === "topUp" ? "Session top-ups" : saved?.packages[editing.index] ? "Edit package" : "New package"}
      label={editing.kind === "topUp" ? "Save top-ups" : saved?.packages[editing.index] ? "Save package" : "Add package"}>
      <div className={`${styles.section} ${styles.formStack}`}>
        {editing.kind === "package" ? <>
          <label>Price (₱)<input inputMode="decimal" value={editing.draft.price} onChange={e => setDraft({ price: e.target.value })} /></label>
          <div className={styles.pair}>
            <label>Sessions<input inputMode="numeric" value={editing.draft.sessions} onChange={e => setDraft({ sessions: e.target.value })} /></label>
            <label>Valid for (days)<input inputMode="numeric" value={editing.draft.validityDays} onChange={e => setDraft({ validityDays: e.target.value })} /></label>
          </div>
          {draftRate && <p className={styles.hintBox}>Works out to <strong>{draftRate} per session</strong> · top-ups are {peso(saved?.topUpPriceMinor ?? 0)}</p>}
          <button type="button" role="switch" aria-checked={editing.draft.visible} className={styles.switchRow} onClick={() => setDraft({ visible: !editing.draft.visible })}>
            <span><span className={styles.switchLabel}>Show to customers</span><small>Turn off to retire it. Packages can&apos;t be deleted.</small></span>
            <span className={styles.verificationSwitch} data-enabled={editing.draft.visible} aria-hidden="true"><span /></span>
          </button>
        </> : <>
          <label>Price per session (₱)<input inputMode="decimal" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} /><small>Coaching only, never gym access.</small></label>
          <label>Valid without a package (days)<input inputMode="numeric" value={editing.days} onChange={e => setEditing({ ...editing, days: e.target.value })} /><small>With a package, it follows that package&apos;s expiry.</small></label>
        </>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </SettingsConfirm>}
  </section>;
}
