"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  IconMore,
  IconOverview,
  IconPeople,
  IconQr,
  IconSettings,
  IconSignOut,
  IconStatistics,
} from "./nav-icons";

// TASKLIST — mobile responsive chrome, "Four + Sheet".
//
// Below the 860px breakpoint the 252px sidebar in `dashboard-nav.tsx` is
// hidden (see `.rs-dashboard-sidebar` in globals.css) and this takes over.
// The bar carries only the three daily-use destinations as icons, plus a
// "More" cell that opens a sheet holding the rest.
//
// Why four cells and not five: Statistics and Print Check-in QR don't reduce
// to glyphs that read reliably without a label. Rather than ship five
// ambiguous icons, the ambiguous destinations move into the sheet, where
// there's room to keep their names. The sheet also keeps the sidebar's
// identity + Sign out block intact instead of displacing it into a page.

interface BarTab {
  label: string;
  href: string;
  Icon: (props: { size?: number; filled?: boolean }) => ReactElement;
  /** `true` → active only on an exact match, so Overview (`/dashboard`)
   *  doesn't light up on every child route. Mirrors `dashboard-nav.tsx`. */
  exact?: boolean;
}

const BAR_TABS: BarTab[] = [
  { label: "Overview", href: "/dashboard", Icon: IconOverview, exact: true },
  { label: "People", href: "/dashboard/people", Icon: IconPeople },
  { label: "Statistics", href: "/dashboard/statistics", Icon: IconStatistics },
];

const SHEET_LINKS = [
  { label: "SMS operations", href: "/dashboard/sms", Icon: IconStatistics },
  { label: "Payment review", href: "/dashboard/payments", Icon: IconStatistics },
  { label: "Audit history", href: "/dashboard/audit", Icon: IconStatistics },
  { label: "QR codes", href: "/dashboard/print-qr", Icon: IconQr },
  { label: "Account Settings", href: "/dashboard/settings", Icon: IconSettings },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  // The sheet stores the route it was opened on rather than a bare boolean, so
  // "open" is derived and any navigation closes it for free — a <Link> inside
  // the sheet changes the route without unmounting this component, and so does
  // the back button. Resetting from a `pathname` effect instead would both
  // trip react-hooks/set-state-in-effect and miss the back-button case.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const sheetOpen = openedOnPath === pathname;

  function setSheetOpen(open: boolean) {
    setOpenedOnPath(open ? pathname : null);
  }

  // A destination inside the sheet is still a current location — the More cell
  // takes the active colour for it, so you're never "nowhere" in the bar.
  const sheetRouteActive = SHEET_LINKS.some((l) => isActive(pathname, l.href));

  // Escape closes, and the page behind is frozen while the sheet is up so the
  // dashboard's long tables don't scroll under it.
  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(event: KeyboardEvent) {
      // The stable setter, not the `setSheetOpen` wrapper: the wrapper closes
      // over `pathname` and is rebuilt each render, which would churn this
      // subscription on every re-render for no reason.
      if (event.key === "Escape") setOpenedOnPath(null);
    }
    // Freeze the app shell's scroll container, not <body>: below 860px the
    // content column owns scrolling (see `.rs-dashboard-content` in
    // globals.css) and the document itself never scrolls, so locking <body>
    // here would be a no-op and the page would still slide under the sheet.
    const scroller = document.querySelector<HTMLElement>(
      ".rs-dashboard-content",
    );
    const previousOverflow = scroller?.style.overflow ?? "";
    if (scroller) scroller.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      if (scroller) scroller.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  async function handleSignOut() {
    setSheetOpen(false);
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="rs-mobile-nav">
      {sheetOpen && (
        <>
          <div
            style={backdropStyle}
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            style={sheetStyle}
          >
            <div style={grabberStyle} aria-hidden />

            <nav style={sheetNavStyle}>
              {SHEET_LINKS.map(({ label, href, Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link key={href} href={href} style={sheetLinkStyle(active)}>
                    <span style={sheetIconWrap}>
                      <Icon size={20} />
                    </span>
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div style={sheetFooterStyle}>
              <div style={identityRow}>
                <div style={avatarStyle}>
                  {(user?.email ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={identityEmail}>{user?.email ?? "—"}</div>
                  <div style={identityRole}>Owner / Admin</div>
                </div>
              </div>
              <button type="button" onClick={handleSignOut} style={signOutStyle}>
                <IconSignOut size={18} />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      <nav style={barStyle} aria-label="Primary">
        {BAR_TABS.map(({ label, href, Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              style={cellStyle(active)}
            >
              <Icon size={22} filled={active} />
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSheetOpen(!sheetOpen)}
          aria-label="More"
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          style={moreCellStyle(sheetOpen || sheetRouteActive)}
        >
          <IconMore size={22} />
        </button>
      </nav>
    </div>
  );
}

// --- styles ---------------------------------------------------------------

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const monoFont = "var(--font-geist-mono), ui-monospace, monospace";

/** Flush to the bottom edge, hard hairline, no float or rounding — the same
 *  industrial chrome as the sidebar it replaces. */
const barStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "stretch",
  height: "calc(58px + env(safe-area-inset-bottom))",
  paddingBottom: "env(safe-area-inset-bottom)",
  background: "var(--rs-panel)",
  borderTop: "1px solid var(--rs-line)",
};

function cellStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    display: "grid",
    placeItems: "center",
    padding: 0,
    textDecoration: "none",
    // Active treatment: the glyph itself goes solid red — no pill, no rule.
    color: active ? "var(--rs-accent)" : "var(--rs-muted)",
    WebkitTapHighlightColor: "transparent",
  };
}

function moreCellStyle(active: boolean): CSSProperties {
  return {
    ...cellStyle(active),
    border: "none",
    background: "transparent",
    cursor: "pointer",
  };
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 70,
  background: "rgba(0, 0, 0, 0.42)",
  animation: "rs-fade-in 140ms ease-out",
};

const sheetStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 80,
  display: "flex",
  flexDirection: "column",
  gap: 18,
  padding: "10px 16px calc(18px + env(safe-area-inset-bottom))",
  background: "var(--rs-panel)",
  borderTop: "1px solid var(--rs-line)",
  animation: "rs-sheet-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
};

const grabberStyle: CSSProperties = {
  width: 38,
  height: 4,
  margin: "0 auto 4px",
  background: "var(--rs-line)",
};

const sheetNavStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

function sheetLinkStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 48,
    padding: "0 12px",
    borderRadius: 6,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: 500,
    background: active ? "var(--rs-accent)" : "transparent",
    color: active ? "var(--rs-on-accent)" : "var(--rs-fg)",
  };
}

const sheetIconWrap: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 20,
  flex: "none",
};

const sheetFooterStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  borderTop: "1px solid var(--rs-line)",
  paddingTop: 16,
};

const identityRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 6px",
};

const avatarStyle: CSSProperties = {
  width: 34,
  height: 34,
  flex: "none",
  borderRadius: "50%",
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
  display: "grid",
  placeItems: "center",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: monoFont,
};

const identityEmail: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const identityRole: CSSProperties = {
  fontSize: 11,
  color: "var(--rs-muted)",
  fontFamily: displayFont,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  marginTop: 2,
};

const signOutStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 46,
  padding: "0 12px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-muted)",
  fontSize: 14,
  cursor: "pointer",
};
