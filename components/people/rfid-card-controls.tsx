"use client";

import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { GYM_TIME_ZONE } from "@/lib/dates";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cardError, rfidAdminApi, type CardStatus } from "@/lib/rfid/admin-api";

export function RfidCardControls({ personId, personName }: { personId: string; personName: string }) {
  const [status, setStatus] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ operation: "assign" | "replace" | "remove"; uid: string | null } | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await rfidAdminApi<CardStatus>(`/api/rfid/admin/assignments?personId=${encodeURIComponent(personId)}`);
      if (mounted.current) { setStatus(next); setError(null); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error && err.name !== "TimeoutError" ? err.message : "Could not load card controls. Check your connection and retry.");
    } finally { inFlight.current = false; }
  }, [personId]);

  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    // Only open, visible profiles poll; no background hardware monitor.
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { mounted.current = false; window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  async function act(operation: "assign" | "replace" | "remove" | "cancel") {
    if (!status) return;
    setBusy(true); setNotice(null);
    try {
      if (operation === "cancel") {
        if (!status.active) return;
        const result = await rfidAdminApi<{ status: string }>("/api/rfid/admin/assignments", "PATCH", { operation, assignmentId: status.active.id });
        setNotice(`Enrollment ${result.status}.`);
      } else if (operation === "remove") {
        await rfidAdminApi("/api/rfid/admin/cards", "POST", { operation, personId, expectedPreviousUid: confirmation?.uid });
        setNotice(`Card removed from ${personName}. Membership and visit history are unchanged.`);
      } else {
        await rfidAdminApi("/api/rfid/admin/assignments", "POST", { operation, personId, expectedPreviousUid: confirmation?.uid ?? null });
      }
      setConfirmation(null);
    } catch (err) {
      setNotice(err instanceof Error && err.name !== "TimeoutError" ? err.message : "Could not confirm the action. Review the shared request before retrying.");
      setConfirmation(null);
    } finally { await refresh(); setBusy(false); }
  }

  const disabled = busy || !!error || !status || status.unavailable;
  const latest = status?.latest;
  return (
    <section style={panel} aria-label="RFID card controls">
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-barlow-condensed)", fontSize: 24 }}>RFID card</h2>
        <span style={{ color: "var(--rs-muted)", fontSize: 13 }}>{error ? "Scanner status unavailable" : !status ? <span role="status" aria-label="Loading scanner…"><Skeleton width={100} /></span> : `Scanner ${status.scanner.online ? "online" : "offline"}`}</span>
      </div>
      <p style={{ fontFamily: "var(--font-geist-mono)", overflowWrap: "anywhere" }}>{error ? "Card status unavailable" : !status ? <span role="status" aria-label="Loading card…"><Skeleton width={160} /></span> : status.uid ?? "No card assigned"}</p>
      <p style={hint}>Cards are optional for members and guests. Enrollment assigns a card and never records a visit.</p>
      {error && <div role="alert"><p>{error}</p><button style={button} onClick={() => void refresh()}>Retry card controls</button></div>}
      {status && !error && <>
        {!status.scanner.online && <p style={hint}>Reconnect the scanner to assign or replace cards. Removal and QR attendance remain available.</p>}
        {status.unavailable && <p role="alert">This profile is being removed. Card actions are unavailable.</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button style={button} disabled={disabled || !status.scanner.online || !!status.active} onClick={() => setConfirmation({ operation: status.uid ? "replace" : "assign", uid: status.uid })}>{status.uid ? "Replace Card" : "Assign Card"}</button>
          {status.uid && <button style={button} disabled={disabled || !!status.active} onClick={() => setConfirmation({ operation: "remove", uid: status.uid })}>Remove Card</button>}
        </div>
        {status.active ? <div role="status" style={feedback}>
          <strong>Assignment mode — {status.active.personName}</strong>
          <p>Tap a card to {status.active.operation === "replace" ? "replace their current card" : "assign it"}. This shared request ends at {new Date(status.active.expiresAt).toLocaleTimeString("en-PH", { timeZone: GYM_TIME_ZONE })}. Attendance taps are blocked until enrollment ends.</p>
          {status.active.personId !== personId && <p><Link href={`/dashboard/people/${status.active.personId}`}>View {status.active.personName}&apos;s profile</Link></p>}
          {status.active.lastErrorCode && <p role="alert">{cardError(status.active.lastErrorCode)} The request remains pending.</p>}
          <button style={button} disabled={busy} onClick={() => void act("cancel")}>{busy ? "Working…" : `Cancel enrollment for ${status.active.personName}`}</button>
        </div> : <p style={hint}>Attendance mode — the scanner is available for normal check-in and check-out when online.</p>}
        {latest && latest.status !== "pending" && <p role="status" style={feedback}>{latest.status === "completed" ? `Last enrollment completed for ${personName} with card ${latest.capturedUid ?? ""}.` : `Enrollment for ${personName} ${latest.status}. The request did not change their card.`}</p>}
      </>}
      {notice && <p role="status" style={feedback}>{notice}</p>}
      {confirmation && <div role="group" aria-label="Confirm card action" style={feedback}>
        <strong>{confirmation.operation === "remove" ? "Remove card from" : confirmation.operation === "replace" ? "Replace card for" : "Assign card to"} {personName}?</strong>
        <p>{confirmation.operation === "remove" ? "Their card will stop working for RFID attendance. Membership and visit history will be kept." : confirmation.operation === "replace" ? "The current card stays assigned until a new card is confirmed. Enrollment taps do not count as visits." : "The entrance scanner will enter assignment mode for this person. Enrollment taps do not count as visits."}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={button} disabled={disabled || !!status?.active || (confirmation.operation !== "remove" && !status?.scanner.online)} onClick={() => void act(confirmation.operation)}>{busy ? "Working…" : confirmation.operation === "remove" ? "Confirm Remove Card" : "Confirm and arm enrollment"}</button>
          <button style={button} disabled={busy} onClick={() => setConfirmation(null)}>Go back</button>
        </div>
      </div>}
    </section>
  );
}

const panel: CSSProperties = { padding: 24, marginBottom: 24, border: "1px solid var(--rs-line)", borderRadius: 8, background: "var(--rs-panel)" };
const hint: CSSProperties = { color: "var(--rs-muted)", fontSize: 13, lineHeight: 1.6 };
const button: CSSProperties = { padding: "10px 16px", minHeight: 44, border: "1px solid var(--rs-line)", borderRadius: 6, background: "var(--rs-bg)", color: "var(--rs-fg)", cursor: "pointer" };
const feedback: CSSProperties = { marginTop: 16, padding: 16, background: "var(--rs-bg)", borderLeft: "2px solid var(--rs-accent)", fontSize: 14, lineHeight: 1.6, overflowWrap: "anywhere" };
