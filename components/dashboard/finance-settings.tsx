"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { GymSettings, Rates } from "@/lib/finance/contracts";
import { parsePesoInput } from "@/lib/finance/rules";

const fields: Array<[keyof Rates, string]> = [
  ["studentDailyMinor", "Student daily"], ["regularDailyMinor", "Regular daily"],
  ["studentMonthlyMinor", "Student monthly"], ["regularMonthlyMinor", "Regular monthly"],
];
export function FinanceSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<{ id: string; payload: string } | null>(null);
  async function load() {
    if (!user) return;
    const response = await fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
    if (!response.ok) throw new Error("Could not load pricing. Try again.");
    const next: GymSettings = await response.json();
    setSettings(next);
    setValues(Object.fromEntries(fields.map(([key]) => [key, next[key] === null ? "" : (next[key]! / 100).toFixed(2)])));
  }
  useEffect(() => { let active = true;
    if (!user) return;
    user.getIdToken().then(token => fetch("/api/finance/settings", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error("Could not load pricing. Try again.");
        const next: GymSettings = await response.json();
        if (!active) return;
        setSettings(next);
        setValues(Object.fromEntries(fields.map(([key]) => [key, next[key] === null ? "" : (next[key]! / 100).toFixed(2)])));
      }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [user]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!user || !settings) return;
    setBusy(true); setMessage("");
    try {
      const rates = Object.fromEntries(fields.map(([key]) => [key, parsePesoInput(values[key] ?? "")]));
      const payload = JSON.stringify({ ...rates, rateRevision: settings.rateRevision });
      const id = attempt?.payload === payload ? attempt.id : crypto.randomUUID();
      setAttempt({ id, payload });
      const response = await fetch("/api/finance/settings", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}`,
      }, body: JSON.stringify({ ...rates, rateRevision: settings.rateRevision, operationId: id }) });
      if (!response.ok) {
        if (response.status === 409) { await load(); setAttempt(null); throw new Error("Pricing changed. Review the refreshed rates and save again."); }
        throw new Error("Could not save rates. Check the amounts and retry.");
      }
      setSettings(await response.json()); setAttempt(null); setMessage("Rates saved. Existing purchases keep their original prices.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save rates."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="finance-settings-title">
    <h2 id="finance-settings-title">Collection rates</h2>
    <p>Prices in Philippine pesos. Leave monthly prices empty to keep membership purchases unavailable. Package and custom-expiry prices are not configured.</p>
    {!settings ? <button type="button" onClick={() => load().catch(error => setMessage(error.message))}>Load pricing</button> :
      <form onSubmit={save} style={{ display: "grid", gap: 14 }}>
        {fields.map(([key, label]) => <label key={key} style={{ display: "grid", gap: 6 }}>
          {label} (PHP)
          <input aria-label={`${label} (PHP)`} inputMode="decimal" required={key.includes("Daily")} disabled={busy}
            value={values[key] ?? ""} onChange={e => setValues({ ...values, [key]: e.target.value })}
            style={{ minHeight: 44, padding: 10, fontSize: 16, width: "100%", color: "var(--rs-fg)", background: "var(--rs-bg)", border: "1px solid var(--rs-line)" }} />
        </label>)}
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save rates"}</button>
        <p>Financial reporting begins when pricing is first saved. Historical attendance is never converted into payments.</p>
      </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
