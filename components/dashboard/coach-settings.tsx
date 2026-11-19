"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { SettingsConfirm } from "./settings-confirm";
import styles from "./settings.module.css";

interface Coach { id: string; name: string; email: string; active: boolean; createdAt: number; deactivatedAt: number | null }
type Pending = { action: "create" } | { action: "reset-password" | "deactivate"; coach: Coach };
const messages: Record<string, string> = {
  "coach-email-taken": "That email already has a login. Use a different email.",
  "invalid-coach-name": "Enter the coach's name.",
  "invalid-coach-email": "Enter a valid email address.",
  "invalid-coach-password": "Use a password of 8 to 128 characters.",
  "coach-unavailable": "This coach no longer exists. Reload the list.",
  "coach-deactivated": "This coach is deactivated, so their password can't be reset.",
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";

export function CoachSettings({ onSaved }: { onSaved(message: string): void }) {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [pending, setPending] = useState<Pending | null>(null), [newPassword, setNewPassword] = useState("");
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

  async function confirmPending() {
    if (!user || !pending || busy) return;
    const body = pending.action === "create" ? { action: "create", ...form }
      : { action: pending.action, coachId: pending.coach.id, ...(pending.action === "reset-password" ? { password: newPassword } : {}) };
    const done = pending.action === "create" ? `Coach account created for ${form.name.trim()}. Share the password privately.`
      : pending.action === "reset-password" ? `Password reset for ${pending.coach.name}. They were signed out everywhere.` : `${pending.coach.name} was deactivated.`;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/coaches", { method: "POST", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messages[result.error] ?? "Could not confirm the change. Reload the list to check it.");
      close(); onSaved(done); setReload(value => value + 1);
      if (pending.action === "create") setForm({ name: "", email: "", password: "" });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the change."); }
    finally { setBusy(false); }
  }
  function close() { setPending(null); setNewPassword(""); setError(""); }
  function choose(event: MouseEvent<HTMLButtonElement>, next: Pending) {
    event.currentTarget.closest("details")?.removeAttribute("open");
    setPending(next);
  }

  return <section className={styles.section} aria-labelledby="coach-settings-title">
    <div className={styles.head}>
      <div><h2 id="coach-settings-title">Coaches</h2><p className={styles.sub}>Same login page. They only see the coach portal.</p></div>
      <button type="button" className={styles.primary} onClick={() => setPending({ action: "create" })}>Add coach</button>
    </div>
    {!pending && error && <><p className={styles.error} role="alert">{error}</p>{!coaches && <button type="button" onClick={() => { setError(""); setReload(v => v + 1); }}>Reload coaches</button>}</>}
    {!coaches && !error && <div className={styles.skeleton} aria-label="Loading coaches" />}
    {coaches?.length === 0 && <div className={styles.empty}><h3>No coaches yet</h3><p>Add a coach to give them portal access.</p></div>}
    {!!coaches?.length && <ul className={styles.cardList}>{coaches.map(coach => <li key={coach.id} className={styles.itemCard}>
      <span className={styles.coachAvatar} aria-hidden="true">{initials(coach.name)}</span>
      <div>
        <p className={styles.coachName}>{coach.name}<span className={styles.coachState} data-active={coach.active}>{coach.active ? "Active" : "Deactivated"}</span></p>
        <p className={styles.itemMeta}>{coach.email}</p>
      </div>
      {coach.active && <details className={`${styles.menu} ${styles.coachMenu}`}>
        <summary aria-label={`Actions for ${coach.name}`}><svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden focusable="false"><path d="M12 6h.01M12 12h.01M12 18h.01" /></svg></summary>
        <div className={styles.menuItems}>
          <button type="button" disabled={busy} onClick={e => choose(e, { action: "reset-password", coach })}>Reset password</button>
          <button type="button" disabled={busy} className={styles.danger} onClick={e => choose(e, { action: "deactivate", coach })}>Deactivate…</button>
        </div>
      </details>}
    </li>)}</ul>}

    {pending && <SettingsConfirm sheet={pending.action === "create"} busy={busy} danger={pending.action === "deactivate"} onCancel={close} onConfirm={() => void confirmPending()}
      title={pending.action === "create" ? "Add a coach" : pending.action === "deactivate" ? `Deactivate ${pending.coach.name}?` : `Reset ${pending.coach.name}'s password?`}
      label={pending.action === "create" ? "Create coach" : pending.action === "deactivate" ? "Deactivate" : "Reset password"}
      confirmDisabled={pending.action === "create" ? !form.name.trim() || !form.email.trim() || form.password.length < 8 : pending.action === "reset-password" && newPassword.length < 8}>
      {pending.action === "create" ? <div className={`${styles.section} ${styles.formStack}`}>
        <label>Name<input required maxLength={100} autoComplete="off" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Email<input required type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
        <label>Starting password<input required type="text" minLength={8} maxLength={128} autoComplete="new-password" spellCheck={false} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <small>8+ characters. They can change it later.</small></label>
      </div> : pending.action === "deactivate"
        ? <p>They are signed out and can no longer log in. This can&apos;t be undone.</p>
        : <label className={styles.section}>New starting password<input type="text" autoFocus minLength={8} maxLength={128} autoComplete="new-password" spellCheck={false} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <small>At least 8 characters. Share it with the coach privately.</small></label>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </SettingsConfirm>}
  </section>;
}
