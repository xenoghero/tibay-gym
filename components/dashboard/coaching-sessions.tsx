"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { timeLabel } from "@/lib/coaching/bookings";
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
  const [reload, setReload] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [report, setReport] = useState("");
  useEffect(() => {
    let active = true;
    call("/api/admin/freezes").then(result => { if (active) { setRequests(result.requests); setError(""); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on explicit reload only
  }, [reload]);
  async function decide(packageRecordId: string, decision: "approve" | "reject") {
    if (busy) return;
    setBusy(true); setError(""); setReport("");
    try {
      const result: { cancelled?: { date: string; start: number }[] } = await call("/api/admin/freezes", { packageRecordId, decision });
      const cancelled = result.cancelled ?? [], day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      setReport(decision === "reject" ? "Freeze request rejected." : cancelled.length
        ? `Freeze approved. Cancelled ${cancelled.length} session${cancelled.length === 1 ? "" : "s"} inside it: ${cancelled.map(row => `${day(row.date)} ${timeLabel(row.start)}`).join(", ")}.`
        : "Freeze approved. No sessions were booked inside it.");
      setReload(v => v + 1); onChanged();
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not decide the request."); }
    finally { setBusy(false); }
  }
  if (!requests?.length && !error && !report) return null;
  return <section aria-labelledby="freeze-requests-title" style={{ marginTop: 24 }}>
    <h2 id="freeze-requests-title" className={view.subhead}>Freeze requests</h2>
    <p className={styles.error} role="alert">{error}</p>
    {report && <p role="status" style={{ margin: "0 0 12px", fontSize: 13 }}>{report}</p>}
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
