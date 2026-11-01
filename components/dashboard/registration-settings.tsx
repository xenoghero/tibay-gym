"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import type { RegistrationSettings as Settings } from "@/lib/registration-settings";
import styles from "./settings.module.css";

export function RegistrationSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    if (!user) return;
    user.getIdToken().then(token => fetch("/api/admin/registration-settings", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        if (!response.ok) throw new Error("Could not load registration settings.");
        const data: Settings = await response.json();
        if (active) { setSettings(data); setError(""); }
      }).catch(() => { if (active) setError("Could not load registration settings."); });
    return () => { active = false; };
  }, [user, reload]);

  async function toggle() {
    if (!user || !settings || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/registration-settings", { method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: settings.revision, requireVerification: !settings.requireVerification }) });
      if (!response.ok) throw new Error(response.status === 409
        ? "This setting changed in another session. Reload before trying again."
        : "Could not confirm the change. Reload to check the saved setting.");
      const data: Settings = await response.json();
      setSettings(data); setMessage("Registration setting saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save registration settings."); }
    finally { setBusy(false); }
  }

  return <section className={styles.verificationGroup} aria-labelledby="registration-settings-title">
    <h2 id="registration-settings-title" className={`rs-set-group-label ${styles.verificationLabel}`}>Profile verification</h2>
    <div className={`rs-set-rows ${styles.verificationRows}`}>
      <button type="button" role="switch" aria-checked={settings?.requireVerification ?? true}
        aria-label="Require verification for new accounts" aria-describedby="registration-settings-description"
        aria-busy={busy} className={`rs-set-row rs-set-row-btn ${styles.verificationRow}`}
        disabled={!settings || busy || !!error} onClick={() => void toggle()}>
        <span className={styles.verificationMain}>
          <span className={styles.verificationTitle}>Require verification for new accounts</span>
          <span className={styles.verificationDescription} id="registration-settings-description">
            {!settings ? "Loading registration settings…" : settings.requireVerification
              ? "New profiles go to Unverified members for admin review."
              : "New profiles are automatically verified and added to People."}
          </span>
        </span>
        <span className={styles.verificationControl} aria-hidden="true">
          <span className={styles.verificationState}>{busy ? "Saving…" : !settings ? "Loading…" : settings.requireVerification ? "Enabled" : "Disabled"}</span>
          <span className={styles.verificationSwitch} data-enabled={settings?.requireVerification ?? true}><span /></span>
        </span>
      </button>
    </div>
    <p className={styles.verificationHint}>Applies to new registrations only. Existing unverified profiles still need review.</p>
    {error && <div className={styles.verificationError} role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setSettings(null); setError(""); setReload(value => value + 1); }}>Reload setting</button></div>}
    {message && <p className={styles.verificationFeedback} role="status">{message}</p>}
  </section>;
}
