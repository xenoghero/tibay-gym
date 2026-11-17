"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { coachProfile } from "@/lib/auth/staff-home";
import { BrandLogo } from "@/components/brand-logo";
import { BrandLoading } from "@/components/ui/brand-loading";
import { CoachClients } from "./coach-clients";
import styles from "./coach.module.css";

type Profile = { id: string; name: string; email: string };

export default function CoachPortalPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    let active = true;
    // Anyone who isn't an active coach goes back through the shared login routing.
    coachProfile(user).then(found => { if (!active) return; if (found) setProfile(found); else router.replace("/dashboard"); })
      .catch(() => { if (active) router.replace("/login"); });
    return () => { active = false; };
  }, [user, loading, router]);

  if (!user || !profile) return <BrandLoading label="Loading the coach portal" fullscreen />;
  return <main className={styles.page}>
    <header className={styles.header}>
      <BrandLogo className={styles.logo} />
      <button type="button" className={styles.ghost} onClick={() => void signOut().then(() => router.replace("/login"))}>Sign out</button>
    </header>
    <section className={styles.intro}>
      <p className={styles.kicker}>Coach portal</p>
      <h1>Hi, {profile.name}</h1>
      <p className={styles.muted}>{profile.email}</p>
    </section>
    <CoachClients user={user} />
    <ChangePassword />
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
  return <form className={styles.card} onSubmit={submit} aria-labelledby="coach-password">
    <h2 id="coach-password">Change password</h2>
    <label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} /></label>
    <label>New password<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next} onChange={e => setNext(e.target.value)} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
    <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
  </form>;
}
