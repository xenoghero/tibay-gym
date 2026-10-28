"use client";

import { useState, type CSSProperties } from "react";
import {
  effectiveMemberStatus,
  overrideMemberStatus,
  type MemberStatus,
  type Person,
} from "@/lib/db";
import { statusBadgeStyle } from "@/lib/status-badge";

// Manual status override (TASKLIST Phase 3, members only). Flips Active ↔
// Expired independent of the stored expiry date. A non-blank reason is
// required before the confirm submits; every override appends a StatusChange
// audit row (handled atomically in `overrideMemberStatus`).

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const bodyFont = "var(--font-geist-sans), system-ui, sans-serif";

interface StatusOverrideProps {
  person: Person;
  /** Called after a successful override so the parent can refetch. */
  onChanged?: () => void;
}

export function StatusOverride({ person, onChanged }: StatusOverrideProps) {
  // Derived from `membershipExpiry`, not the raw stored field — a lapsed
  // expiry with no override yet still shows "Expired" here, matching what
  // every other display site (Overview, People, Person Profile) now shows.
  const current = effectiveMemberStatus(person);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Guests have no membership standing to override.
  if (person.type !== "member" || !current) return null;

  const target: MemberStatus = current === "active" ? "expired" : "active";
  const targetLabel = target === "active" ? "Active" : "Expired";
  const reasonOk = reason.trim().length > 0;

  function reset() {
    setConfirming(false);
    setReason("");
    setError(null);
  }

  async function handleConfirm() {
    if (!reasonOk) {
      setError("Enter a reason before confirming.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await overrideMemberStatus({
        personId: person.id,
        fromStatus: current as MemberStatus,
        toStatus: target,
        reason: reason.trim(),
      });
      reset();
      setNotice(`Status updated to ${targetLabel}.`);
      onChanged?.();
    } catch (err) {
      console.error("[StatusOverride] override failed", err);
      setError("Couldn't apply the override. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      style={{
        border: "1px solid var(--rs-line)",
        borderRadius: 8,
        padding: 20,
        fontFamily: bodyFont,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: displayFont,
            fontSize: 20,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          Membership status
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--rs-muted)" }}>
          Overrides the standing shown across the dashboard, independent of the
          stored expiry date.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--rs-muted)" }}>Current:</span>
        <StatusBadge status={current} />
      </div>

      {notice && (
        <div role="status" style={noticeStyle}>
          {notice}
        </div>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setConfirming(true);
          }}
          style={secondaryButtonStyle}
        >
          Mark as {targetLabel}
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
            background: "var(--rs-panel)",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
            Mark {person.name} as {targetLabel}?
          </p>
          <label
            htmlFor="override-reason"
            style={{ fontSize: 13, fontWeight: 500 }}
          >
            Reason (required)
          </label>
          <textarea
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Comp, Freeze, Early termination, Renewal"
            style={{
              padding: "9px 11px",
              border: `1px solid ${error ? "var(--rs-accent)" : "var(--rs-line)"}`,
              borderRadius: 6,
              background: "var(--rs-bg)",
              color: "var(--rs-fg)",
              outline: "none",
              fontFamily: bodyFont,
              fontSize: 14,
              resize: "vertical",
            }}
          />
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--rs-accent-text)" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || !reasonOk}
              style={{
                ...primaryButtonStyle,
                cursor: submitting ? "wait" : !reasonOk ? "not-allowed" : "pointer",
                opacity: submitting || !reasonOk ? 0.6 : 1,
              }}
            >
              {submitting ? "Applying…" : `Confirm — mark ${targetLabel}`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={submitting}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: MemberStatus }) {
  const active = status === "active";
  return (
    <span style={statusBadgeStyle(active ? "active" : "expired")}>
      {active ? "Active" : "Expired"}
    </span>
  );
}

const primaryButtonStyle: CSSProperties = {
  height: 40,
  padding: "0 16px",
  border: "none",
  borderRadius: 6,
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
  fontFamily: displayFont,
  fontSize: 14,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const secondaryButtonStyle: CSSProperties = {
  height: 40,
  padding: "0 16px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontFamily: bodyFont,
  fontSize: 14,
  cursor: "pointer",
};

const noticeStyle: CSSProperties = {
  padding: "10px 12px",
  background: "var(--rs-panel)",
  borderLeft: "2px solid var(--rs-muted)",
  fontSize: 13,
  color: "var(--rs-muted)",
};
