"use client";

import { useContentTransition } from "@/lib/use-content-transition";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
} from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { auth } from "@/lib/firebase";
import { useToastQueue } from "@/lib/use-toast-queue";
import { IconSignOut } from "@/components/dashboard/nav-icons";
import { FinanceSettings } from "@/components/dashboard/finance-settings";
import { VoucherSettings } from "./voucher-settings";
import settingsStyles from "./settings.module.css";

// Hash navigation retains the settings section on refresh/back. Hidden sections
// remain mounted to preserve drafts when switching between pricing and vouchers.
const subscribeSection = (listener: () => void) => { window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); };
const currentSection = () => ["vouchers", "account"].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : "pricing";

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";

type FieldErrors = {
  current?: string;
  next?: string;
  confirm?: string;
};

function describePasswordError(err: unknown): FieldErrors {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return { current: "Current password is incorrect" };
  }
  if (code === "auth/weak-password") {
    return { next: "Password should be at least 6 characters" };
  }
  return { current: "Something went wrong. Try again." };
}

/** Disclosure caret for the "Change password" row. */
function IconCaret({ open }: { open: boolean }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="rs-set-caret"
      style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none" }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Trailing arrow for rows that fire an action rather than expand. */
function IconGo() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M5 12h13M13 7l5 5-5 5" />
    </svg>
  );
}

export function AccountSettingsView() {
  const { user, signOut } = useAuth();
  const section = useSyncExternalStore(subscribeSection, currentSection, () => "pricing");
  const tabContent = useRef<HTMLDivElement>(null);
  useContentTransition(tabContent, section);
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const { current: toast, push: flash } = useToastQueue();

  const currentRef = useRef<HTMLInputElement>(null);

  // Opening the disclosure puts the caret in the first field, so expanding and
  // typing is one gesture instead of two.
  useEffect(() => {
    if (open) currentRef.current?.focus();
  }, [open]);

  function togglePanel() {
    setOpen((wasOpen) => {
      if (wasOpen) {
        // Collapsing discards the form. Holding three typed passwords in state
        // behind a closed row is worse than making the admin retype them.
        setCurrent("");
        setNext("");
        setConfirm("");
        setErrors({});
      }
      return !wasOpen;
    });
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;

    const mismatch = next !== confirm;

    setErrors({});
    setBusy(true);
    try {
      // Reauthenticate first even when the new passwords mismatch, so a wrong
      // current password surfaces on this same submit instead of being
      // hidden behind the mismatch error — the admin would otherwise only
      // learn about it after fixing the mismatch and resubmitting.
      const credential = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(user, credential);

      if (mismatch) {
        setErrors({ confirm: "New passwords don't match" });
        return;
      }

      await updatePassword(user, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      // Nothing left to do in the panel, and the toast is the confirmation —
      // collapsing returns the page to its three-row resting state.
      setOpen(false);
      flash("Password updated.");
    } catch (err) {
      console.error("[AccountSettingsView] password update failed", err);
      const serverErrors = describePasswordError(err);
      setErrors(mismatch ? { ...serverErrors, confirm: "New passwords don't match" } : serverErrors);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendReset() {
    if (!user?.email) return;
    setResetBusy(true);
    try {
      await sendPasswordResetEmail(auth, user.email);
      flash(`Password reset email sent to ${user.email}.`);
    } catch (err) {
      console.error("[AccountSettingsView] reset email failed", err);
      flash("Couldn't send the reset email. Try again.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const email = user?.email ?? null;

  return (
    <main className={`rs-set ${settingsStyles.page}`} style={pageStyle}>
      {/* Matches the Overview header: kicker over an oversized display title,
          nothing beside it. */}
      <header className="rs-set-head" style={headerRow}>
        <div>
          <div className="rs-set-kicker" style={kickerStyle}>
            Owner / admin
          </div>
          <h1 className="rs-set-title" style={headingStyle}>
            Account settings
          </h1>
        </div>
      </header>

      <p className="rs-set-lead" style={leadStyle}>
        Manage gym pricing, vouchers, and your admin account.
      </p>

      <div className={settingsStyles.layout}>
      <nav className={settingsStyles.navigation} aria-label="Settings sections">
        {[["pricing", "Pricing"], ["vouchers", "Vouchers"], ["account", "Account & security"]].map(([id, label]) => <a key={id} href={`#${id}`} aria-current={section === id ? "page" : undefined}>{label}</a>)}
      </nav>
      <div ref={tabContent} className={settingsStyles.content}>
      <div hidden={section !== "pricing"}><FinanceSettings /></div>
      <div hidden={section !== "vouchers"}><VoucherSettings /></div>
      <div hidden={section !== "account"} className={settingsStyles.account}>

      <section style={groupStyle}>
        <h2 className="rs-set-group-label" style={groupLabelStyle}>
          Login
        </h2>
        <div className="rs-set-rows" style={rowsStyle}>
          <div className="rs-set-row" style={rowStyle}>
            <span style={rowMain}>
              <span style={rowTitleStyle}>Email</span>
              <span style={rowEmailStyle}>{email ?? "—"}</span>
            </span>
            <span style={rowTrailStyle}>Not editable</span>
          </div>
        </div>
      </section>

      <section style={groupStyle}>
        <h2 className="rs-set-group-label" style={groupLabelStyle}>
          Security
        </h2>
        <div className="rs-set-rows" style={rowsStyle}>
          <button
            type="button"
            onClick={togglePanel}
            aria-expanded={open}
            aria-controls="rs-set-password-panel"
            className="rs-set-row rs-set-row-btn"
            style={rowButtonStyle}
          >
            <span style={rowMain}>
              <span style={rowTitleStyle}>Change password</span>
              <span style={rowSubStyle}>Confirm with your current password</span>
            </span>
            <IconCaret open={open} />
          </button>

          {open && (
            <form
              id="rs-set-password-panel"
              onSubmit={handleChangePassword}
              className="rs-set-panel"
              style={panelStyle}
            >
              <div style={fieldGroup}>
                <label htmlFor="rs-set-current" style={labelStyle}>
                  Current password
                </label>
                <input
                  id="rs-set-current"
                  ref={currentRef}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  style={inputStyle(Boolean(errors.current))}
                />
                {errors.current && <span style={errorText}>{errors.current}</span>}
              </div>

              <div style={fieldGroup}>
                <label htmlFor="rs-set-next" style={labelStyle}>
                  New password
                </label>
                <input
                  id="rs-set-next"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                  minLength={6}
                  style={inputStyle(Boolean(errors.next))}
                />
                {errors.next ? (
                  <span style={errorText}>{errors.next}</span>
                ) : (
                  <span style={hintText}>At least 6 characters.</span>
                )}
              </div>

              <div style={fieldGroup}>
                <label htmlFor="rs-set-confirm" style={labelStyle}>
                  Confirm new password
                </label>
                <input
                  id="rs-set-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  style={inputStyle(Boolean(errors.confirm))}
                />
                {errors.confirm && <span style={errorText}>{errors.confirm}</span>}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="rs-set-submit"
                style={primaryButton}
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={handleSendReset}
            disabled={resetBusy || !email}
            className="rs-set-row rs-set-row-btn"
            style={rowButtonStyle}
          >
            <span style={rowMain}>
              <span style={rowTitleStyle}>Send reset email</span>
              <span style={rowSubStyle}>
                {resetBusy
                  ? "Sending…"
                  : "For when the current password isn't at hand"}
              </span>
            </span>
            <IconGo />
          </button>
        </div>
      </section>

      <section style={groupStyle}>
        <h2 className="rs-set-group-label" style={groupLabelStyle}>
          Session
        </h2>
        <div className="rs-set-rows" style={rowsStyle}>
          <button
            type="button"
            onClick={handleSignOut}
            className="rs-set-row rs-set-row-btn rs-set-row-danger"
            style={dangerRowStyle}
          >
            <span style={rowMain}>
              <span style={rowTitleStyle}>Sign out</span>
              <span style={rowSubStyle}>Ends this session on this device</span>
            </span>
            <IconSignOut size={18} />
          </button>
        </div>
      </section>

      </div>
      </div>
      </div>
      {toast && (
        <div className="rs-set-toast" style={toastWrap}>
          <div style={toastInner}>
            <span style={toastDot} />
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}

// --- styles ---------------------------------------------------------------

const pageStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  width: "100%",
  maxWidth: 1280,
  padding: "34px 40px 60px",
  display: "flex",
  flexDirection: "column",
  gap: 22,
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
};

// Matches the Overview tab's date kicker so the two headers read as one system.
const kickerStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "var(--rs-muted)",
};

const headingStyle: CSSProperties = {
  fontFamily: displayFont,
  fontSize: 46,
  lineHeight: 1,
  fontWeight: 600,
  textTransform: "uppercase",
  margin: "8px 0 0",
};

// Pulled up against the page's 22px column gap: the lead belongs to the header
// above it, not to the first group below it.
const leadStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--rs-muted)",
  margin: "-10px 0 0",
};

const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 9,
};

const groupLabelStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 11,
  fontWeight: 400,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "var(--rs-muted)",
  margin: 0,
  paddingLeft: 2,
};

// The box around one group's rows. Dividers between rows, the hover tint and
// the narrow full-bleed treatment live in globals.css — they need sibling and
// pseudo-class selectors that inline styles can't express.
const rowsStyle: CSSProperties = {
  border: "1px solid var(--rs-line)",
  borderRadius: 10,
  overflow: "hidden",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "15px 18px",
  minHeight: 56,
};

const rowButtonStyle: CSSProperties = {
  ...rowStyle,
  width: "100%",
  background: "transparent",
  border: "none",
  color: "var(--rs-fg)",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const dangerRowStyle: CSSProperties = {
  ...rowButtonStyle,
  color: "var(--rs-accent-text)",
};

const rowMain: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
};

const rowTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
};

const rowSubStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
};

const rowEmailStyle: CSSProperties = {
  fontFamily: monoFont,
  fontSize: 13,
  color: "var(--rs-muted)",
  overflowWrap: "anywhere",
};

const rowTrailStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
  flexShrink: 0,
};

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "4px 18px 20px",
  background: "var(--rs-panel)",
};

const fieldGroup: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

function inputStyle(hasError: boolean): CSSProperties {
  return {
    height: 46,
    padding: "0 12px",
    border: `1px solid ${hasError ? "var(--rs-accent-text)" : "var(--rs-line)"}`,
    background: "var(--rs-bg)",
    color: "var(--rs-fg)",
    borderRadius: 6,
    outline: "none",
    // Explicit, and never below 16px: form controls don't inherit the body's
    // font-size, and iOS Safari zooms the viewport when a focused input's text
    // is smaller than 16px. That zoom doesn't undo itself on blur.
    fontSize: 16,
    fontFamily: "inherit",
  };
}

const hintText: CSSProperties = {
  fontSize: 12,
  color: "var(--rs-muted)",
};

const errorText: CSSProperties = {
  display: "flex",
  padding: "9px 11px",
  background: "var(--rs-accent-soft)",
  borderLeft: "2px solid var(--rs-accent-text)",
  fontSize: 13,
  color: "var(--rs-accent-text)",
};

const primaryButton: CSSProperties = {
  alignSelf: "flex-start",
  height: 46,
  padding: "0 22px",
  border: "none",
  borderRadius: 6,
  background: "var(--rs-accent)",
  color: "var(--rs-on-accent)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const toastWrap: CSSProperties = {
  position: "fixed",
  bottom: 26,
  left: "50%",
  transform: "translateX(-50%)",
  maxWidth: "calc(100vw - 32px)",
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
  flexShrink: 0,
};
