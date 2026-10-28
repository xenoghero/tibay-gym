"use client";

import type { ReactNode } from "react";
import { RequireAuth } from "@/lib/auth/require-auth";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { MobileBottomNav } from "@/components/dashboard/mobile-bottom-nav";

// TASKLIST Phase 7 — persistent dashboard chrome. Every route under
// `/dashboard` renders inside the signed-in-only shell, so the nav is there
// "at all times once logged in" (admin-dashboard-content.md §0). The
// individual pages still carry their own <RequireAuth> as a belt-and-braces
// guard; it's a no-op once this layout's guard has already passed.
//
// Both navs mount at every width and the CSS in globals.css shows exactly one:
// the sidebar above 860px, the bottom bar at or below it. Rendering both and
// hiding one in CSS (rather than measuring the viewport in JS) keeps the shell
// correct on the server render, so there's no flash of the wrong nav on load.
//
// The two classes below are the app shell. Below 860px `.rs-dashboard-shell` is
// locked to one viewport and `.rs-dashboard-content` becomes the only scroll
// container, so the bottom bar is genuinely fixed rather than riding a
// scrolling document. Above it, both are inert and the page scrolls normally
// under the sticky sidebar. The heights live in globals.css because they're
// breakpoint-dependent and inline styles can't carry media queries.

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div
        className="rs-dashboard-shell"
        style={{
          display: "flex",
          background: "var(--rs-bg)",
          color: "var(--rs-fg)",
        }}
      >
        <DashboardNav />
        {/* Plain block flow, not a nested flex context: legacy dashboard pages
            (Print QR, profile forms) render their own full-width <main> and
            should keep behaving exactly as before. */}
        <div
          className="rs-dashboard-content"
          style={{ flex: 1, minWidth: 0 }}
        >
          {children}
        </div>
      </div>
      <MobileBottomNav />
    </RequireAuth>
  );
}
