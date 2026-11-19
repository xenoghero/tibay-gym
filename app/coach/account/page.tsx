"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import portal from "@/components/checkin/customer-access.module.css";
import { useCoach } from "../coach-shell";
import styles from "../coach.module.css";

export default function CoachAccountPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { profile } = useCoach();
  const leave = () => void signOut().then(() => router.replace("/login"));
  return <main className={`${portal.portal} ${styles.pane}`}>
    <div className={portal.portalHeading}><h1>Account</h1></div>
    <div className={styles.identity}>
      <span aria-hidden="true">{profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
      <div><strong>{profile.name}</strong><small>{profile.email} · Coach</small></div>
    </div>
    <ChangePassword />
    <button type="button" className={`${portal.secondaryButton} ${styles.full}`} onClick={leave}>Sign out of the coach portal</button>
  </main>;
}

function ChangePassword() {
  const { user } = useAuth();
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user?.email || busy) return;
    setError(""); setMessage("");
    if (next.length < 8) { setError("Use at least 8 characters for the new password."); return; }
    if (next !== confirm) { setError("The new passwords don't match."); return; }
    setBusy(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      setCurrent(""); setNext(""); setConfirm(""); setMessage("Password updated.");
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      setError(code === "auth/invalid-credential" || code === "auth/wrong-password" ? "Current password is incorrect." : "Could not update the password. Try again.");
    } finally { setBusy(false); }
  }
  return <form className={`${styles.panel} ${styles.form}`} onSubmit={submit} aria-labelledby="coach-password">
    <h2 id="coach-password" className={styles.title}>Change password</h2>
    <label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} /></label>
    <label>New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={e => setNext(e.target.value)} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
    <p className={styles.hint}>At least 8 characters.</p>
    {error && <p className={portal.error} role="alert">{error}</p>}
    {message && <p className={portal.confirmation} role="status">{message}</p>}
    <button type="submit" className={`${portal.primaryButton} ${portal.membershipCta}`} disabled={busy}>{busy ? "Updating…" : "Update password"}<span aria-hidden="true">›</span></button>
  </form>;
}
