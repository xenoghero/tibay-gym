"use client";

import { FormInput } from "@/components/ui/form-input";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { GymSettings, Rates } from "@/lib/finance/contracts";
import { parsePesoInput } from "@/lib/finance/rules";
import { SettingsConfirm } from "./settings-confirm";
import styles from "./settings.module.css";
const fields: Array<[keyof Rates, string]> = [["studentDailyMinor", "Student daily"], ["regularDailyMinor", "Regular daily"], ["studentMonthlyMinor", "Student monthly"], ["regularMonthlyMinor", "Regular monthly"]];
const valuesFor = (s: GymSettings) => Object.fromEntries(fields.map(([key]) => [key, s[key] === null ? "" : (s[key]! / 100).toFixed(2)]));
const money = (v: number | null) => v === null ? "Not configured" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v / 100);
export function FinanceSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<GymSettings | null>(null), [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}), [review, setReview] = useState<Rates | null>(null), [conflict, setConflict] = useState<GymSettings | null>(null);
  const attempt = useRef<{ id: string; payload: string } | null>(null);
  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const response = await fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error("Could not load pricing. Try again.");
      const next: GymSettings = await response.json(); setSettings(next); setValues(valuesFor(next)); setMessage("");
    } finally { setLoading(false); }
  }
  useEffect(() => { let active = true;
    if (user) user.getIdToken().then(token => fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => { if (!response.ok) throw new Error("Could not load pricing. Try again."); const next: GymSettings = await response.json(); if (active) { setSettings(next); setValues(valuesFor(next)); } })
      .catch(e => { if (active) setMessage(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  function validate(event: FormEvent) {
    event.preventDefault(); const errors: Record<string, string> = {}, rates: Record<string, number | null> = {};
    for (const [key] of fields) { try { rates[key] = parsePesoInput(values[key]); if (key.includes("Daily") && rates[key] === null) errors[key] = "Daily pricing is required."; } catch { errors[key] = "Enter a positive PHP amount with up to two decimal places."; } }
    setErrors(errors); if (!Object.keys(errors).length) setReview(rates as unknown as Rates);
  }
  async function save() {
    if (!user || !settings || !review) return;
    setBusy(true); setMessage("");
    try {
      const payload = JSON.stringify({ ...review, rateRevision: settings.rateRevision });
      if (attempt.current?.payload !== payload) attempt.current = { id: crypto.randomUUID(), payload };
      const response = await fetch("/api/finance/settings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ ...review, rateRevision: settings.rateRevision, operationId: attempt.current.id }) });
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
          if (latest.ok) setConflict(await latest.json());
          setReview(null); throw new Error("Pricing changed in another session. Your draft is preserved. Review the latest rates below.");
        }
        throw new Error("Could not save rates. Your changes are preserved; try again.");
      }
      const saved = await response.json(); setSettings(saved); setValues(valuesFor(saved)); setEditing(false); setReview(null); attempt.current = null;
      setMessage("Rates saved. Existing purchases keep their original prices.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save rates."); }
    finally { setBusy(false); }
  }
  const changed = settings && fields.some(([key]) => values[key] !== valuesFor(settings)[key]);
  return <section className={styles.section} aria-labelledby="pricing-title" aria-busy={loading}>
    <div className={styles.head}><div><h2 id="pricing-title">Gym pricing</h2><p className={styles.sub}>Daily visits and one-month memberships, in Philippine pesos.</p></div></div>
    {loading ? <LoadingSkeleton label="Loading pricing…" variant="form" count={4} /> : !settings ? <button onClick={() => load().catch(e => setMessage(e.message))}>Retry loading pricing</button> : <form onSubmit={validate}>
      <div className={styles.pricingGrid}>
        {(["student", "regular"] as const).map(category => <section key={category} className={styles.pricingCard} aria-labelledby={`pricing-${category}`}>
          <header><h3 id={`pricing-${category}`}>{category === "student" ? "Student" : "Regular"}</h3><p className={styles.sub}>{category === "student" ? "Student rate category" : "Standard rate category"}</p></header>
          <div className={styles.priceTerms}>
          {(["Daily", "Monthly"] as const).map(term => { const key = `${category}${term}Minor` as keyof Rates; return <div key={term} className={styles.priceTerm}>
            <span className={styles.priceLabel}>{term} · PHP</span>
            {editing ? <><FormInput aria-label={`${category === "student" ? "Student" : "Regular"} ${term.toLowerCase()} (PHP)`} inputMode="decimal" value={values[key] ?? ""} disabled={busy} aria-invalid={!!errors[key]} aria-describedby={`${key}-hint`} onChange={e => setValues({ ...values, [key]: e.target.value })} />
              <small id={`${key}-hint`} className={errors[key] ? styles.error : ""}>{errors[key] || (term === "Monthly" ? "Leave empty to disable new purchases." : "Required for paid daily visits.")}</small></> : <><span className={styles.priceAmount} data-unconfigured={settings[key] === null}>{money(settings[key])}</span>{settings[key] === null && <small>Membership purchases unavailable</small>}</>}
          </div>; })}</div></section>)}
      </div>
      <div className={styles.pricingControls}>
        {editing ? <><button type="button" disabled={busy} onClick={() => { setValues(valuesFor(settings)); setEditing(false); setErrors({}); setConflict(null); setMessage(""); }}>Cancel</button><button type="submit" className={styles.primary} disabled={busy || !changed || !!conflict}>Save changes</button></> : <button type="button" className={styles.primary} onClick={() => setEditing(true)}>Edit prices</button>}
      </div>
      <div className={styles.footer}><p className={styles.sub}>{settings.updatedAt ? `Updated ${new Date(settings.updatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} · Philippine time` : "Default daily rates. Save to begin financial reporting."}<small>Revision {settings.rateRevision} · Existing submitted prices are preserved.</small></p>
      </div>
      {!settings.financialCutoverAt && <p className={styles.sub}>Financial reporting starts on the first save. Historical attendance remains unchanged.</p>}
    </form>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {conflict && <div className={styles.preview}><strong>Latest saved rates</strong>{fields.map(([key, label]) => <p key={key}>{label}: {money(conflict[key])} · Your draft: {values[key] || "Not configured"}</p>)}<button onClick={() => { setSettings(conflict); setConflict(null); setReview(null); }}>Keep draft and review against these rates</button></div>}
    {review && settings && <SettingsConfirm title="Save pricing changes?" busy={busy} onCancel={() => setReview(null)} onConfirm={() => void save()} label="Save changes"><p>These prices apply to new purchases. Submitted purchases retain their original prices.</p>{fields.filter(([key]) => settings[key] !== review[key]).map(([key, label]) => <p key={key}><strong>{label}</strong><br />{money(settings[key])} → {money(review[key])}{review[key] === null && <small>New membership purchases for this category will be unavailable.</small>}</p>)}{message && <p role="status">{message}</p>}</SettingsConfirm>}
  </section>;
}
