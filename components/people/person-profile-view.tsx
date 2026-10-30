"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import {
  AUTO_CLOSE_AFTER_MS,
  deletePerson,
  deleteVisit,
  effectiveMemberStatus,
  forceCloseSession,
  getPerson,
  getProfileDetails,
  getVisitHistoryForPerson,
  recalcVisitStats,
  type AttendanceLog,
  type Person,
  type ProfileDetails,
} from "@/lib/db";
import {
  formatClockTime,
  formatDateTime,
  getAgeFromBirthDate,
  formatLongDate,
  formatShortDateTime,
} from "@/lib/dates";
import { useToastQueue } from "@/lib/use-toast-queue";
import { statusBadgeStyle, typeBadgeStyle } from "@/lib/status-badge";
import { WeightProgressionSection } from "@/components/people/weight-progression-section";
import { BackLink } from "@/components/people/back-link";
import { RfidCardControls } from "@/components/people/rfid-card-controls";
import { PrivateProfilePhoto } from "@/components/people/private-profile-photo";

// TASKLIST Phase 8 — Admin Dashboard: Person Profile
// (admin-dashboard-content.md §4).
//
// Full detail + management for one person: every stored field, the reverse-
// chronological visit history, a current-session banner, and the force-close /
// delete actions with person-named confirmations and post-action toasts. Edit
// and the members-only status override keep their existing home on
// `/dashboard/people/[id]/edit` (Phase 3); this page links across to it.

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";


interface PersonProfileViewProps {
  personId: string;
}

type LoadState =
  | { state: "loading" }
  | { state: "not-found" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      person: Person;
      profileDetails: ProfileDetails | null;
      profileDetailsError: string | null;
      visits: AttendanceLog[];
      visitsError: string | null;
    };

type Modal = null | "delete" | "force-close" | "delete-visit";

// Give the profile assembly enough time to complete its first scan when the
// database responds immediately. Slower requests are never delayed further.
const PROFILE_LOADING_MIN_MS = 1500;

const CLOSED_LABEL: Record<string, string> = {
  implicit: "Closed by new check-in",
  auto: "Auto-closed after 4h",
  manual: "Closed by admin",
};

/**
 * The visit-history query (`personId ==` + `orderBy checkInAt desc`) needs a
 * composite index — tracked in `firestore.indexes.json` for `firebase deploy`,
 * but a fresh/reset project won't have it built yet. Firestore's own error
 * names the exact console link to create it on the spot, so surface that
 * instead of a generic "check your connection" message the admin can't act on.
 */
function describeVisitHistoryError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/requires an index/i.test(message)) {
    return "Visit history isn't set up yet — it needs a one-time step from whoever manages the system. Contact them and mention \"missing database index on attendanceLogs.\"";
  }
  return "Couldn't load visit history. Check your connection and refresh.";
}

export function PersonProfileView({ personId }: PersonProfileViewProps) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const { current: toast, push: flash } = useToastQueue();
  const [deleted, setDeleted] = useState(false);
  const [visitToDelete, setVisitToDelete] = useState<AttendanceLog | null>(null);
  const deleteRedirectTimer = useRef<number | null>(null);

  // If the admin manually navigates away during the post-delete pause, don't
  // let the queued redirect yank them back to People afterward.
  useEffect(() => {
    return () => {
      if (deleteRedirectTimer.current !== null) {
        window.clearTimeout(deleteRedirectTimer.current);
      }
    };
  }, []);

  const fetchAll = useCallback(async (): Promise<LoadState> => {
    let person: Person | null;
    try {
      person = await getPerson(personId);
    } catch (err) {
      console.error("[PersonProfileView] load failed", err);
      return {
        state: "error",
        message: "Couldn't load this profile. Check your connection and refresh.",
      };
    }
    if (!person) return { state: "not-found" };

    let profileDetails: ProfileDetails | null = null;
    let profileDetailsError: string | null = null;
    try {
      profileDetails = await getProfileDetails(personId);
    } catch (err) {
      console.error("[PersonProfileView] profile details load failed", err);
      profileDetailsError =
        "Couldn’t load private details. Check your connection and try again.";
    }

    try {
      const visits = await getVisitHistoryForPerson(personId);
      return {
        state: "ready",
        person,
        profileDetails,
        profileDetailsError,
        visits,
        visitsError: null,
      };
    } catch (err) {
      console.error("[PersonProfileView] visit history load failed", err);
      return {
        state: "ready",
        person,
        profileDetails,
        profileDetailsError,
        visits: [],
        visitsError: describeVisitHistoryError(err),
      };
    }
  }, [personId]);

  useEffect(() => {
    let active = true;
    let revealTimer: number | null = null;
    const startedAt = performance.now();

    fetchAll().then((next) => {
      if (!active) return;

      const remaining = PROFILE_LOADING_MIN_MS - (performance.now() - startedAt);
      if (remaining <= 0) {
        setLoad(next);
        return;
      }

      revealTimer = window.setTimeout(() => {
        revealTimer = null;
        if (active) setLoad(next);
      }, remaining);
    });

    return () => {
      active = false;
      if (revealTimer !== null) window.clearTimeout(revealTimer);
    };
  }, [fetchAll]);

  async function refetch() {
    setLoad(await fetchAll());
  }

  if (load.state === "loading") {
    return (
      <Frame>
        <ProfileLoadingState />
      </Frame>
    );
  }
  if (load.state === "not-found") {
    return (
      <Frame>
        <p style={mutedText}>
          No profile matches this link.{" "}
          <Link href="/dashboard/people" style={inlineLink}>
            Back to People
          </Link>
        </p>
      </Frame>
    );
  }
  if (load.state === "error") {
    return (
      <Frame>
        <p style={mutedText}>{load.message}</p>
      </Frame>
    );
  }

  const {
    person,
    profileDetails,
    profileDetailsError,
    visits,
    visitsError,
  } = load;

  if (deleted) {
    return (
      <Frame>
        <div style={sessionBannerClosed}>
          <strong style={{ color: "var(--rs-fg)" }}>{person.name}</strong>&apos;s
          profile was deleted. Returning to People…
        </div>
      </Frame>
    );
  }

  const isMember = person.type === "member";
  const openSession = visits.find((v) => v.checkOutAt === null) ?? null;
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const age = getAgeFromBirthDate(profileDetails?.birthDate ?? null);
  const identityFields: { k: string; v: string }[] = [
    { k: "Type", v: isMember ? "Member" : "Guest" },
    {
      k: "Status",
      v: isMember
        ? effectiveMemberStatus(person) === "expired"
          ? "Expired"
          : "Active"
        : "—",
    },
    { k: "Phone", v: person.phone },
  ];
  const recordFields: { k: string; v: string }[] = [
    { k: "Membership expiry", v: formatLongDate(person.membershipExpiry) },
    { k: "Join date", v: formatLongDate(person.joinDate) },
    { k: "Visit count", v: String(person.visitCount) },
    { k: "Created", v: formatDateTime(person.createdAt) },
    { k: "Last updated", v: formatDateTime(person.updatedAt) },
  ];

  async function handleForceClose() {
    if (!openSession) return;
    setBusy(true);
    try {
      await forceCloseSession(openSession.id);
      setModal(null);
      await refetch();
      flash("Session closed.");
    } catch (err) {
      console.error("[PersonProfileView] force-close failed", err);
      setModal(null);
      flash(err instanceof Error ? err.message : "Couldn't close the session. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deletePerson(person.id);
      setModal(null);
      setDeleted(true);
      deleteRedirectTimer.current = window.setTimeout(() => {
        deleteRedirectTimer.current = null;
        router.push("/dashboard/people");
      }, 1300);
    } catch (err) {
      console.error("[PersonProfileView] delete failed", err);
      setBusy(false);
      setModal(null);
      flash(err instanceof Error ? err.message : "Couldn't delete the profile. Try again.");
    }
  }

  async function handleDeleteVisit() {
    if (!visitToDelete) return;
    setBusy(true);
    try {
      await deleteVisit({ logId: visitToDelete.id, personId: person.id });
      setModal(null);
      setVisitToDelete(null);
      await refetch();
      flash("Visit deleted and count updated.");
    } catch (err) {
      console.error("[PersonProfileView] delete visit failed", err);
      setModal(null);
      setVisitToDelete(null);
      flash(err instanceof Error ? err.message : "Couldn't delete the visit. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecalc() {
    setBusy(true);
    try {
      const { visitCount } = await recalcVisitStats(person.id);
      await refetch();
      flash(`Visit count recalculated from history: ${visitCount}.`);
    } catch (err) {
      console.error("[PersonProfileView] recalc failed", err);
      flash(err instanceof Error ? err.message : "Couldn't recalculate the visit count. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const autoCloseAt = openSession
    ? Timestamp.fromMillis(
        openSession.checkInAt.toMillis() + AUTO_CLOSE_AFTER_MS,
      )
    : null;

  return (
    <Frame>
      <BackLink href="/dashboard/people" label="Back to people" />

      <div className="rs-pp-head" style={headerRow}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", minWidth: 0 }}>
          {person.profileImagePath ? <PrivateProfilePhoto personId={person.id} /> : <div className="rs-pp-avatar" style={avatarStyle}>{initials || "?"}</div>}
          <div style={{ minWidth: 0 }}>
            <h1 className="rs-pp-title" style={headingStyle}>{person.name}</h1>
            <div style={headerMetaRow}>
              <span style={typeBadgeStyle()}>{isMember ? "Member" : "Guest"}</span>
              <span>{person.rateCategory === "student" ? "Student" : person.rateCategory === "regular" ? "Regular" : "Category unclassified"}</span>
              {isMember && (
                <span
                  style={statusBadgeStyle(
                    effectiveMemberStatus(person) === "expired"
                      ? "expired"
                      : "active",
                  )}
                >
                  {effectiveMemberStatus(person) === "expired"
                    ? "Expired"
                    : "Active"}
                </span>
              )}
              <span style={headerPhone}>{person.phone}</span>
            </div>
          </div>
        </div>

        <div className="rs-pp-actions" style={actionRow}>
          {isMember && (
            <Link href={`/dashboard/people/${person.id}/renew`} className="rs-pp-action rs-pp-action-primary" style={primaryButton}>
              Renew membership
            </Link>
          )}
          <Link
            href={`/dashboard/people/${person.id}/edit`}
            className="rs-pp-action rs-pp-action-secondary"
            style={secondaryButton}
          >
            Edit profile
          </Link>
          {!isMember && (
            <Link
              href={`/dashboard/people/${person.id}/convert`}
              className="rs-pp-action rs-pp-action-secondary"
              style={secondaryButton}
            >
              Convert to member
            </Link>
          )}
          {openSession && (
            <button
              type="button"
              onClick={() => setModal("force-close")}
              className="rs-pp-action rs-pp-action-secondary"
              style={secondaryButton}
            >
              Force-close session
            </button>
          )}
          <button
            type="button"
            onClick={() => setModal("delete")}
            className="rs-pp-action rs-pp-action-danger"
            style={destructiveButton}
          >
            Delete profile
          </button>
        </div>
      </div>

      {openSession ? (
        <div style={sessionBannerOpen}>
          <span style={sessionBannerHeading}>
            Checked in since {formatClockTime(openSession.checkInAt)}
          </span>
          <span style={sessionBannerNote}>
            Session opened by {openSession.source.toUpperCase()}.
            {autoCloseAt
              ? ` Auto-closes ${formatClockTime(autoCloseAt)} if there is no further activity.`
              : ""}
          </span>
        </div>
      ) : (
        <div style={sessionBannerClosed}>Not currently checked in</div>
      )}

      <RfidCardControls key={person.id} personId={person.id} personName={person.name} />

      <div className="rs-pp-cols" style={columnsRow}>
        <section style={cardStyle}>
          <h2 style={cardHeading}>Profile</h2>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {identityFields.map((f) => (
              <div key={f.k} className="rs-pp-field" style={fieldRow}>
                <span className="rs-pp-field-k" style={{ color: "var(--rs-muted)" }}>
                  {f.k}
                </span>
                <span className="rs-pp-field-v" style={fieldValue}>{f.v}</span>
              </div>
            ))}
            {profileDetailsError ? (
              <p role="alert" style={privateDetailsErrorStyle}>
                {profileDetailsError}
              </p>
            ) : (
              <>
                <ProfileDetailRow
                  label="Birth date"
                  value={
                    profileDetails?.birthDate
                      ? formatLongDate(profileDetails.birthDate)
                      : "Not provided"
                  }
                  isProvided={Boolean(profileDetails?.birthDate)}
                />
                <ProfileDetailRow
                  label="Current age"
                  value={age === null ? "Not provided" : `${age} ${age === 1 ? "year" : "years"}`}
                  isProvided={age !== null}
                />
                <ProfileDetailRow
                  label="Address"
                  value={profileDetails?.address?.trim() || "Not provided"}
                  isProvided={Boolean(profileDetails?.address?.trim())}
                  multiline
                />
              </>
            )}
            {recordFields.map((f) => (
              <div key={f.k} className="rs-pp-field" style={fieldRow}>
                <span className="rs-pp-field-k" style={{ color: "var(--rs-muted)" }}>
                  {f.k}
                </span>
                <span className="rs-pp-field-v" style={fieldValue}>{f.v}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          className="rs-pp-visitcard"
          style={{ ...cardStyle, padding: 0, overflow: "hidden" }}
        >
          <div style={visitHeaderStyle}>
            <h2 style={{ ...cardHeading, margin: 0 }}>Visit history</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {visits.length > 0 && (
                <span style={visitHintStyle}>Newest first</span>
              )}
              <button
                type="button"
                onClick={handleRecalc}
                disabled={busy}
                style={recalcButton}
                title="Recount visits from the visit history and reset the visit count / last visit"
              >
                {busy ? "Working…" : "Recalculate count"}
              </button>
            </div>
          </div>

          {visitsError ? (
            <div style={visitEmptyStyle}>
              <div style={visitEmptyHeading}>Visit history unavailable</div>
              <p style={visitEmptyText}>{visitsError}</p>
            </div>
          ) : visits.length === 0 ? (
            <div style={visitEmptyStyle}>
              <div style={visitEmptyHeading}>No visits yet</div>
              <p style={visitEmptyText}>
                Check-ins at the entrance poster or RFID reader will show up here.
              </p>
            </div>
          ) : (
            <>
              <div className="rs-pp-visit-head" style={visitHeadRow}>
                <span>Checked in</span>
                <span>Checked out</span>
                <span>Source</span>
                <span>Closed by</span>
                <span aria-hidden />
              </div>
              {visits.map((v) => {
                const open = v.checkOutAt === null;
                return (
                  <div key={v.id} className="rs-pp-visit-row" style={visitRow}>
                    <span className="rs-pp-visit-in" style={monoCell}>
                      {formatShortDateTime(v.checkInAt)}
                    </span>
                    <span
                      className="rs-pp-visit-out"
                      style={{
                        ...monoCell,
                        color: open ? "var(--rs-accent-text)" : "var(--rs-fg)",
                      }}
                    >
                      {open
                        ? "Still checked in"
                        : formatShortDateTime(v.checkOutAt)}
                    </span>
                    <span className="rs-pp-visit-source" style={sourceCell}>
                      {v.source.toUpperCase()}
                    </span>
                    <span
                      className="rs-pp-visit-closed"
                      style={{ color: "var(--rs-muted)", fontSize: 13 }}
                    >
                      {open
                        ? "Session open"
                        : CLOSED_LABEL[v.closedReason ?? ""] ?? "Closed"}
                    </span>
                    <button
                      type="button"
                      className="rs-pp-visit-del"
                      onClick={() => {
                        setVisitToDelete(v);
                        setModal("delete-visit");
                      }}
                      disabled={busy}
                      style={visitDeleteButton}
                      title="Delete this visit and update the count"
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </section>
      </div>

      <WeightProgressionSection
        personId={person.id}
        personName={person.name}
        notify={flash}
      />

      {modal === "delete" && (
        <ModalShell onCancel={() => !busy && setModal(null)}>
          <h3 style={modalHeading}>Delete {person.name}&apos;s profile?</h3>
          <p style={modalBody}>
            This permanently removes {person.name}, their entire visit history,
            and any status-change records. They&apos;ll stop counting toward
            Statistics and Most frequent visitors. This can&apos;t be undone.
          </p>
          <div style={modalActions}>
            <button
              type="button"
              onClick={() => setModal(null)}
              disabled={busy}
              style={modalCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              style={modalDestructive}
            >
              {busy ? "Deleting…" : "Delete profile"}
            </button>
          </div>
        </ModalShell>
      )}

      {modal === "force-close" && openSession && (
        <ModalShell onCancel={() => !busy && setModal(null)}>
          <h3 style={modalHeading}>
            End {person.name}&apos;s current session?
          </h3>
          <p style={modalBody}>
            This marks them as checked out right now, stamped as closed by admin.
          </p>
          <div style={modalActions}>
            <button
              type="button"
              onClick={() => setModal(null)}
              disabled={busy}
              style={modalCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleForceClose}
              disabled={busy}
              style={modalConfirm}
            >
              {busy ? "Closing…" : "End session"}
            </button>
          </div>
        </ModalShell>
      )}

      {modal === "delete-visit" && visitToDelete && (
        <ModalShell
          onCancel={() => {
            if (busy) return;
            setModal(null);
            setVisitToDelete(null);
          }}
        >
          <h3 style={modalHeading}>Delete this visit?</h3>
          <p style={modalBody}>
            Removes the check-in from{" "}
            {formatShortDateTime(visitToDelete.checkInAt)} and drops{" "}
            {person.name}&apos;s visit count by one. This can&apos;t be undone.
          </p>
          <div style={modalActions}>
            <button
              type="button"
              onClick={() => {
                setModal(null);
                setVisitToDelete(null);
              }}
              disabled={busy}
              style={modalCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteVisit}
              disabled={busy}
              style={modalDestructive}
            >
              {busy ? "Deleting…" : "Delete visit"}
            </button>
          </div>
        </ModalShell>
      )}

      {toast && (
        <div style={toastWrap}>
          <div style={toastInner}>
            <span style={toastDot} />
            {toast}
          </div>
        </div>
      )}
    </Frame>
  );
}

// --- layout frame -----------------------------------------------------------

function ProfileLoadingState() {
  return <LoadingSkeleton label="Loading profile" variant="profile" count={5} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="rs-pp" style={pageStyle}>
      {children}
    </main>
  );
}

function ModalShell({
  children,
  onCancel,
}: {
  children: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <div style={overlayStyle} onClick={onCancel} role="presentation">
      <div
        style={modalCardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function ProfileDetailRow({
  label,
  value,
  isProvided,
  multiline = false,
}: {
  label: string;
  value: string;
  isProvided: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="rs-pp-field" style={fieldRow}>
      <span className="rs-pp-field-k" style={{ color: "var(--rs-muted)" }}>
        {label}
      </span>
      <span
        className="rs-pp-field-v"
        style={{
          ...privateDetailsValueStyle,
          color: isProvided ? "var(--rs-fg)" : "var(--rs-muted)",
          whiteSpace: multiline && isProvided ? "pre-wrap" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// --- styles ---------------------------------------------------------------

const pageStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "34px 40px 60px",
  display: "flex",
  flexDirection: "column",
  gap: 22,
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
};

const mutedText: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: "var(--rs-muted)",
};

const inlineLink: CSSProperties = { color: "var(--rs-accent-text)" };

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
};

const avatarStyle: CSSProperties = {
  width: 56,
  height: 56,
  flex: "none",
  borderRadius: "50%",
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
  display: "grid",
  placeItems: "center",
  fontFamily: displayFont,
  fontSize: 22,
  fontWeight: 600,
};

const headingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 42,
  lineHeight: 1,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: 0,
};

const headerMetaRow: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 8,
  flexWrap: "wrap",
};

const headerPhone: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 12,
  color: "var(--rs-muted)",
};

const actionRow: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

// Three tiers now, so the row reads at a glance: a solid primary for Edit, a
// firmer outline for the situational actions (Convert / Force-close), and a
// accent-outline Delete that fills in on hover (the fill lives in globals.css —
// inline styles can't carry `:hover`).
const primaryButton: CSSProperties = {
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 18px",
  border: "1px solid var(--rs-fg)",
  borderRadius: 6,
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
  fontFamily: displayFont,
  fontSize: 14,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  cursor: "pointer",
  textDecoration: "none",
};

const secondaryButton: CSSProperties = {
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 14px",
  border: "1px solid var(--rs-muted)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  textDecoration: "none",
};

const destructiveButton: CSSProperties = {
  ...secondaryButton,
  border: "1px solid var(--rs-accent)",
  color: "var(--rs-accent-text)",
};

const sessionBannerOpen: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "14px 18px",
  borderRadius: 10,
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
};

const sessionBannerHeading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 20,
  fontWeight: 600,
  textTransform: "uppercase",
};

const sessionBannerNote: CSSProperties = {
  fontSize: 13,
  opacity: 0.8,
};

const sessionBannerClosed: CSSProperties = {
  padding: "14px 18px",
  borderRadius: 10,
  border: "1px solid var(--rs-line)",
  color: "var(--rs-muted)",
  fontSize: 14,
};

const columnsRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1.35fr",
  gap: 20,
  alignItems: "start",
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  padding: 20,
};

const cardHeading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 20,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "0 0 14px",
};

const privateDetailsErrorStyle: CSSProperties = {
  margin: "12px 0 0",
  paddingTop: 12,
  borderTop: "1px solid var(--rs-line)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--rs-accent-text)",
};

const privateDetailsValueStyle: CSSProperties = {
  maxWidth: "72%",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "right",
  overflowWrap: "anywhere",
};

const fieldRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  padding: "11px 0",
  borderTop: "1px solid var(--rs-line)",
  fontSize: 13,
};

const fieldValue: CSSProperties = {
  fontFamily: monoFont,
  textAlign: "right",
  wordBreak: "break-word",
};

const visitHeaderStyle: CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid var(--rs-line)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const visitHintStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
};

const recalcButton: CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const visitDeleteButton: CSSProperties = {
  justifySelf: "end",
  padding: "4px 10px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-accent-text)",
  fontSize: 12,
  cursor: "pointer",
};

const visitGridColumns = "1.1fr 1.1fr 0.6fr 1fr auto";

const visitHeadRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: visitGridColumns,
  gap: 14,
  padding: "11px 20px",
  background: "var(--rs-panel)",
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
};

const visitRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: visitGridColumns,
  gap: 14,
  padding: "13px 20px",
  borderTop: "1px solid var(--rs-line)",
  fontSize: 13,
  alignItems: "center",
};

const monoCell: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 13,
};

const sourceCell: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--rs-muted)",
};

const visitEmptyStyle: CSSProperties = {
  padding: "48px 24px",
  textAlign: "center",
};

const visitEmptyHeading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 22,
  fontWeight: 600,
  textTransform: "uppercase",
};

const visitEmptyText: CSSProperties = {
  fontSize: 14,
  color: "var(--rs-muted)",
  margin: "8px auto 0",
  maxWidth: "40ch",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10, 10, 10, 0.55)",
  display: "grid",
  placeItems: "center",
  padding: 24,
  zIndex: 40,
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 440,
  background: "var(--rs-bg)",
  border: "1px solid var(--rs-line)",
  borderRadius: 12,
  padding: 26,
  boxShadow: "0 30px 80px rgba(10, 10, 10, 0.28)",
};

const modalHeading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 26,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "0 0 10px",
};

const modalBody: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--rs-muted)",
  margin: "0 0 22px",
};

const modalActions: CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const modalCancel: CSSProperties = {
  height: 40,
  padding: "0 16px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-fg)",
  fontSize: 14,
  cursor: "pointer",
};

const modalDestructive: CSSProperties = {
  height: 40,
  padding: "0 18px",
  border: "none",
  borderRadius: 6,
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const modalConfirm: CSSProperties = {
  ...modalDestructive,
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
};

const toastWrap: CSSProperties = {
  position: "fixed",
  bottom: 26,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 50,
};

const toastInner: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "13px 18px",
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
  borderRadius: 8,
  boxShadow: "0 18px 44px rgba(10, 10, 10, 0.32)",
  fontSize: 14,
};

const toastDot: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--rs-accent)",
};
