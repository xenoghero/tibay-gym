"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import styles from "./settings.module.css";
import view from "./coaching-view.module.css";

function useAdminFetch() {
  const { user } = useAuth();
  return async (path: string, body?: unknown) => {
    if (!user) throw new Error("Sign in again to continue.");
    const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(20_000), ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Could not complete that. Reload and try again.");
    return result;
  };
}

/** Pending Freeze requests: approving starts the Freeze today. */
export function FreezeRequests({ onChanged }: { onChanged(): void }) {
  const call = useAdminFetch();
  const [requests, setRequests] = useState<{ packageRecordId: string; name: string; requestedAt: number; sessionsLeft: number }[] | null>(null);
  const [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    call("/api/admin/freezes").then(result => { if (active) { setRequests(result.requests); setError(""); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on explicit reload only
  }, [reload]);
  async function decide(packageRecordId: string, decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true); setError("");
    try { await call("/api/admin/freezes", { packageRecordId, decision }); setReload(v => v + 1); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not decide the request."); }
    finally { setBusy(false); }
  }
  if (!requests?.length && !error) return null;
  return <section aria-labelledby="freeze-requests-title" style={{ marginTop: 24 }}>
    <h2 id="freeze-requests-title" className={view.subhead}>Freeze requests</h2>
    <p className={styles.error} role="alert">{error}</p>
    {requests && <table className={styles.table}><thead><tr><th scope="col">Client</th><th scope="col">Requested</th><th scope="col">Sessions left</th><th scope="col" aria-label="Actions" /></tr></thead>
      <tbody>{requests.map(row => <tr key={row.packageRecordId}>
        <td>{row.name}</td><td>{new Date(row.requestedAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" })}</td>
        <td className={styles.number}>{row.sessionsLeft}</td>
        <td><div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void decide(row.packageRecordId, "approve")}>Approve (starts today)</button>
          <button type="button" disabled={busy} onClick={() => void decide(row.packageRecordId, "reject")}>Reject</button>
        </div></td>
      </tr>)}</tbody></table>}
  </section>;
}
