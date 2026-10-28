"use client";

import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useAuth } from "@/lib/auth/auth-context";

// TASKLIST Phase 7 — persistent dashboard chrome. The sidebar is rendered by
// `app/dashboard/layout.tsx`, so it stays put across every dashboard route once
// the admin is signed in. It exposes all five destinations named in
// `admin-dashboard-content.md` §0; Statistics and Account Settings are still
// their own later phases, so those links land on a route that doesn't exist yet
// until then — the nav itself is what Phase 7 owns.

interface NavItem {
  label: string;
  href: string;
  /** `true` → active only on an exact path match (Overview is `/dashboard`
   *  itself, which would otherwise match every child route). */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: "Overview", href: "/dashboard", exact: true },
  { label: "People", href: "/dashboard/people" },
  { label: "Statistics", href: "/dashboard/statistics" },
  { label: "Audit history", href: "/dashboard/audit" },
  { label: "Payment review", href: "/dashboard/payments" },
  { label: "SMS operations", href: "/dashboard/sms" },
  { label: "Print Check-in QR", href: "/dashboard/print-qr" },
  { label: "Account Settings", href: "/dashboard/settings" },
];

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="rs-dashboard-sidebar" style={asideStyle}>
      <div style={brandRow}>
        <BrandLogo />
      </div>

      <nav style={navStyle}>
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              style={navLinkStyle(active)}
            >
              <span style={navDot(active)} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div style={footerStyle}>
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
          Sign out
        </button>
      </div>
    </aside>
  );
}

// --- styles ---------------------------------------------------------------

const monoFont = "var(--font-geist-mono), ui-monospace, monospace";

const asideStyle: CSSProperties = {
  width: 252,
  flex: "none",
  background: "var(--rs-panel)",
  borderRight: "1px solid var(--rs-line)",
  display: "flex",
  flexDirection: "column",
  padding: "22px 16px",
  gap: 26,
  position: "sticky",
  top: 0,
  height: "100vh",
};

const brandRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  padding: "0 6px",
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

function navLinkStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 38,
    padding: "0 12px",
    borderRadius: 6,
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
    background: active ? "var(--rs-accent)" : "transparent",
    color: active ? "var(--rs-on-accent)" : "var(--rs-fg)",
  };
}

function navDot(active: boolean): CSSProperties {
  return {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: active ? "var(--rs-on-accent)" : "var(--rs-muted)",
  };
}

const footerStyle: CSSProperties = {
  marginTop: "auto",
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
  width: 30,
  height: 30,
  flex: "none",
  borderRadius: "50%",
  background: "var(--rs-fg)",
  color: "var(--rs-bg)",
  display: "grid",
  placeItems: "center",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: monoFont,
};

const identityEmail: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const identityRole: CSSProperties = {
  fontSize: 11,
  color: "var(--rs-muted)",
};

const signOutStyle: CSSProperties = {
  height: 34,
  padding: "0 12px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--rs-muted)",
  fontSize: 13,
  cursor: "pointer",
  textAlign: "left",
};
