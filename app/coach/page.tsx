"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { coachProfile } from "@/lib/auth/staff-home";
import { BrandLoading } from "@/components/ui/brand-loading";
import { PortalHeader } from "@/components/checkin/portal-header";
import portal from "@/components/checkin/customer-access.module.css";
import { CoachClients } from "./coach-clients";
import { SessionTools } from "./session-tools";
import styles from "./coach.module.css";

type Profile = { id: string; name: string; email: string };
type Tab = "clients" | "account";
const tabs: { tab: Tab; label: string; icon: string }[] = [
  { tab: "clients", label: "Clients", icon: "M6 8h12M4 10v4m16-4v4M2 11v2m20-2v2M8 6v12m8-12v12" },
  { tab: "account", label: "Account", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0" },
];

export default function CoachPortalPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null), [tab, setTab] = useState<Tab>("clients");
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
  const leave = () => void signOut().then(() => router.replace("/login"));
  return <main className={`${portal.portal} ${portal.memberPortal}`}>
    <PortalHeader label="Coach portal" brandLabel="Tibay Gym coach portal">
      <button type="button" className={portal.textButton} onClick={leave}>Sign out ↗</button>
    </PortalHeader>
    <div className={portal.memberWorkspace}>
      <nav className={`${portal.portalNav} ${styles.nav}`} aria-label="Coach navigation">
        {tabs.map(item => <a key={item.tab} href={`#${item.tab}`} aria-current={tab === item.tab ? "page" : undefined}
          onClick={event => { event.preventDefault(); setTab(item.tab); window.scrollTo?.({ top: 0, behavior: "instant" }); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg><span>{item.label}</span>
        </a>)}
      </nav>
      {tab === "clients"
        ? <CoachClients user={user} coachName={profile.name}>{(client, reload) => <SessionTools user={user} coachId={profile.id} client={client} onChanged={reload} />}</CoachClients>
        : <>
          <div className={portal.portalHeading}><h1>Account</h1></div>
          <div className={styles.identity}>
            <span aria-hidden="true">{profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
            <div><strong>{profile.name}</strong><small>{profile.email} · Coach</small></div>
          </div>
          <ChangePassword />
          <button type="button" className={`${portal.secondaryButton} ${styles.full}`} onClick={leave}>Sign out of the coach portal</button>
        </>}
    </div>
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
