"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { SettingsConfirm } from "./settings-confirm";
import styles from "./settings.module.css";

interface Coach { id: string; name: string; email: string; active: boolean; createdAt: number; deactivatedAt: number | null }
const messages: Record<string, string> = {
  "coach-email-taken": "That email already has a login. Use a different email.",
  "invalid-coach-name": "Enter the coach's name.",
  "invalid-coach-email": "Enter a valid email address.",
  "invalid-coach-password": "Use a password of 8 to 128 characters.",
  "coach-unavailable": "This coach no longer exists. Reload the list.",
  "coach-deactivated": "This coach is deactivated, so their password can't be reset.",
};

export function CoachSettings() {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [pending, setPending] = useState<{ action: "reset-password" | "deactivate"; coach: Coach } | null>(null), [newPassword, setNewPassword] = useState("");
  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken().then(token => fetch("/api/admin/coaches", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { coaches: Coach[] } = await response.json();
        if (active) { setCoaches(data.coaches); setError(""); }
      }).catch(() => { if (active) setError("Could not load coaches. Reload to try again."); });
    return () => { active = false; };
  }, [user, reload]);

  async function send(body: Record<string, unknown>, done: string) {
    if (!user || busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/coaches", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messages[result.error] ?? "Could not confirm the change. Reload the list to check it.");
      setMessage(done); setReload(value => value + 1); return true;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the change."); return false; }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await send({ action: "create", ...form }, `Coach account created for ${form.name.trim()}. Share the starting password privately.`)) setForm({ name: "", email: "", password: "" });
  }
  async function confirmPending() {
    if (!pending) return;
    const { action, coach } = pending;
    const ok = await send({ action, coachId: coach.id, ...(action === "reset-password" ? { password: newPassword } : {}) },
      action === "reset-password" ? `Password reset for ${coach.name}. They were signed out everywhere.` : `${coach.name} was deactivated.`);
    if (ok) { setPending(null); setNewPassword(""); }
  }

  return <section className={styles.section} aria-labelledby="coach-settings-title">
    <div className={styles.head}><div>
      <h2 id="coach-settings-title">Coaches</h2>
      <p className={styles.sub}>Coaches sign in on the same login page and only reach the coach portal.</p>
    </div></div>
    <form onSubmit={create}>
      <fieldset disabled={busy}>
        <legend>Add a coach</legend>
        <div className={styles.fields}>
          <label>Name<input required maxLength={100} autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Email<input required type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label className={styles.full}>Starting password<input required type="text" minLength={8} maxLength={128} autoComplete="new-password" spellCheck={false} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <small>The coach can change it after signing in.</small></label>
        </div>
        <div className={styles.actions} style={{ marginTop: 16 }}><button type="submit" className={styles.primary}>{busy ? "Saving…" : "Create coach"}</button></div>
      </fieldset>
    </form>
    <p className={styles.error} role="alert">{error}</p>
    {message && <p className={styles.message} role="status">{message}</p>}
    {!coaches && !error && <div className={styles.skeleton} aria-label="Loading coaches" />}
    {coaches?.length === 0 && <div className={styles.empty}><h3>No coaches yet</h3><p>Create a coach account above.</p></div>}
    {!!coaches?.length && <table className={styles.table}>
      <thead><tr><th scope="col">Coach</th><th scope="col">Status</th><th scope="col" aria-label="Actions" /></tr></thead>
      <tbody>{coaches.map(coach => <tr key={coach.id}>
        <td>{coach.name}<small>{coach.email}</small></td>
        <td><span className={styles.status}>{coach.active ? "Active" : "Deactivated"}</span></td>
        <td>{coach.active && <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => setPending({ action: "reset-password", coach })}>Reset password</button>
          <button type="button" disabled={busy} className={styles.danger} onClick={() => setPending({ action: "deactivate", coach })}>Deactivate</button>
        </div>}</td>
      </tr>)}</tbody>
    </table>}
    {pending && <SettingsConfirm busy={busy} danger={pending.action === "deactivate"} onCancel={() => { setPending(null); setNewPassword(""); setError(""); }} onConfirm={() => void confirmPending()}
      title={pending.action === "deactivate" ? `Deactivate ${pending.coach.name}?` : `Reset ${pending.coach.name}'s password?`}
      label={pending.action === "deactivate" ? "Deactivate" : "Reset password"} confirmDisabled={pending.action === "reset-password" && newPassword.length < 8}>
      {pending.action === "deactivate"
        ? <p>They are signed out and can no longer log in. This can&apos;t be undone.</p>
        : <label className={styles.section}>New starting password<input type="text" autoFocus minLength={8} maxLength={128} autoComplete="new-password" spellCheck={false} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <small>At least 8 characters. Share it with the coach privately.</small></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </SettingsConfirm>}
  </section>;
}
