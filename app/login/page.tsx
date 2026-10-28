"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth/auth-context";

// The login screen is a fixed composition from the "Tibay Gym Admin Dashboard"
// canvas — dark brand panel on the left, light sign-in form on the right —
// so its palette is pinned here rather than following the OS theme. Values
// are the canvas's LIGHT-theme tokens.
const C = {
  ink: "#0d0d0d",
  paper: "#ffffff",
  panel: "#faf8f0",
  muted: "#6f6f6d",
  line: "#e7e2d2",
  accent: "#ffcc00", accentText: "#806000",
  onAccent: "#171400",
  accentSoft: "rgba(255, 204, 0, 0.14)",
  invMuted: "rgba(255, 255, 255, 0.62)",
  invFaint: "rgba(255, 255, 255, 0.42)",
} as const;

const CREDENTIAL_ERROR_CODES = new Set([
  "auth/invalid-credential",
  "auth/invalid-email",
  "auth/user-not-found",
  "auth/wrong-password",
  "auth/user-disabled",
]);

const displayFont = "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), 'Geist Mono', monospace";
const bodyFont = "var(--font-geist-sans), system-ui, sans-serif";

const inputStyle: CSSProperties = {
  height: 48,
  padding: "0 12px",
  border: `1px solid ${C.line}`,
  background: C.paper,
  color: C.ink,
  borderRadius: 6,
  outline: "none",
  // 16px is the floor that stops iOS Safari zooming the viewport on focus.
  fontSize: 16,
  fontFamily: "inherit",
  width: "100%",
};

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500 };

const messageStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "9px 11px",
  fontSize: 13,
};

// Anything the responsive rules below need to override lives in the stylesheet,
// not in a `style` attribute — an inline declaration outranks a media query, so
// a class-based override of an inline value silently loses.
const css = `
  .rs-login-root {
    flex: 1;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    min-height: 100vh;
    /* dvh keeps the hero from being cropped by the mobile URL bar; the vh
       line above it remains the fallback where dvh is unsupported. */
    min-height: 100dvh;
    background: ${C.paper};
    color: ${C.ink};
    letter-spacing: -0.005em;
    font-family: ${bodyFont};
  }

  .rs-login-brand {
    background: ${C.ink};
    color: ${C.paper};
    padding: 56px 56px 40px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .rs-login-blurb {
    max-width: 34ch;
    font-size: 15px;
    line-height: 1.6;
    color: ${C.invMuted};
    margin: 20px 0 0;
  }
  .rs-login-stamp {
    font-family: ${monoFont};
    font-size: 11px;
    color: ${C.invFaint};
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .rs-login-pane { display: grid; place-items: center; padding: 40px; }
  .rs-login-form { width: 100%; max-width: 360px; }
  .rs-login-title {
    font-family: ${displayFont};
    font-size: 38px;
    line-height: 1;
    font-weight: 600;
    text-transform: uppercase;
    margin: 0 0 6px;
  }
  .rs-login-sub { font-size: 14px; color: ${C.muted}; margin: 0 0 28px; }
  .rs-login-forgot {
    align-self: flex-start;
    border: none;
    background: transparent;
    padding: 0;
    font-size: 13px;
    color: ${C.muted};
    cursor: pointer;
  }

  @media (max-width: 860px) {
    .rs-login-root {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      /* Ink shows through behind the sheet's rounded top corners. */
      background: ${C.ink};
    }

    /* The brand panel stops hiding and becomes the poster hero. Its rhythm is
       vh-aware so a short portrait phone (360x640) still lands the CTA above
       the fold instead of pushing it under. */
    .rs-login-brand {
      padding: clamp(20px, 3.5vh, 28px) 20px clamp(30px, 5.5vh, 46px);
      gap: 0;
      justify-content: flex-start;
      /* Give the hero a defined black area so the logo has room to sit in
         its vertical centre rather than hugging the top edge. */
      min-height: 34vh;
    }
    /* Equal auto-margins above the logo and above the stamp split the free
       space: the logo lands mid-panel, the stamp stays pinned to the bottom. */
    .rs-login-logo { margin-top: auto; }
    .rs-login-brand-body { margin-top: 0; }
    /* The sheet's own subhead carries the instruction; the blurb would only
       push the form off the first screen. */
    .rs-login-blurb { display: none; }
    .rs-login-stamp { margin-top: auto; }

    /* Sheet rides up over the hero so the seam reads as one composition. */
    .rs-login-pane {
      place-items: start stretch;
      padding: 30px 20px calc(36px + env(safe-area-inset-bottom));
      background: ${C.paper};
      border-radius: 18px 18px 0 0;
      margin-top: -18px;
      position: relative;
      z-index: 1;
    }
    .rs-login-form { max-width: 440px; margin: 0 auto; }
    .rs-login-title { font-size: 32px; }
    .rs-login-sub { margin-bottom: 22px; }

    /* A 13px text link is not a tap target. */
    .rs-login-forgot {
      align-self: stretch;
      height: 46px;
      border: 1px solid ${C.line};
      border-radius: 6px;
      font-size: 14px;
    }
  }

  /* Landscape phones: the hero collapses to the lockup so the form still fits
     without the headline eating the whole viewport. */
  @media (max-width: 860px) and (max-height: 620px) {
    .rs-login-brand { padding: 18px 20px 30px; gap: 0; min-height: 0; }
    .rs-login-logo { margin-top: 0; }
    .rs-login-brand-body, .rs-login-stamp { display: none; }
  }
`;

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in → skip the form.
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof FirebaseError && CREDENTIAL_ERROR_CODES.has(err.code)) {
        setError("Email or password is incorrect.");
      } else if (
        err instanceof FirebaseError &&
        err.code === "auth/too-many-requests"
      ) {
        setError("Too many attempts. Wait a moment and try again.");
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter the admin email above first, then tap Forgot password.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      // Swallow — don't reveal whether the address is registered.
    }
    setNotice(`Reset email sent to ${email.trim()}.`);
  }

  return (
    <div className="rs-login-root">
      <style>{css}</style>

      {/* Brand panel — the poster hero above the sheet on narrow viewports */}
      <div className="rs-login-brand">
        <BrandLogo hero className="rs-login-logo" />

        <div className="rs-login-brand-body">
          <p className="rs-login-blurb">
            Attendance and membership control for the front desk. One admin
            login, no self-signup.
          </p>
        </div>

        <div className="rs-login-stamp">Admin access only</div>
      </div>

      {/* Sign-in panel — the light sheet riding over the hero on narrow */}
      <div className="rs-login-pane">
        <form className="rs-login-form" onSubmit={handleSubmit}>
          <h1 className="rs-login-title">Sign in</h1>
          <p className="rs-login-sub">
            Use the gym&apos;s admin email and password.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label htmlFor="email" style={labelStyle}>
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label htmlFor="password" style={labelStyle}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...inputStyle, paddingRight: 62 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    height: 48,
                    width: 58,
                    border: "none",
                    background: "transparent",
                    color: C.muted,
                    fontFamily: monoFont,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                  }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Messages sit above the CTA rather than between the fields, so a
                failed attempt never shoves the inputs the user is working in. */}
            {error && (
              <div
                role="alert"
                style={{
                  ...messageStyle,
                  background: C.accentSoft,
                  borderLeft: `2px solid ${C.accentText}`,
                  color: C.accentText,
                }}
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                role="status"
                style={{
                  ...messageStyle,
                  background: C.panel,
                  borderLeft: `2px solid ${C.muted}`,
                  color: C.muted,
                }}
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 50,
                border: "none",
                borderRadius: 6,
                background: C.accent,
                color: C.onAccent,
                fontFamily: displayFont,
                fontSize: 17,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            <button
              type="button"
              className="rs-login-forgot"
              onClick={handleForgotPassword}
            >
              Forgot password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
