"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/lib/auth/require-auth";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";

// TASKLIST Phase 7 — persistent dashboard chrome. Every route under
// `/dashboard` renders inside the signed-in-only shell, so the nav is there
// "at all times once logged in" (admin-dashboard-content.md §0). The
// individual pages still carry their own <RequireAuth> as a belt-and-braces
// guard; it's a no-op once this layout's guard has already passed.
//
// DashboardNav renders the desktop rail or the mobile header and modal drawer.
//
// The two classes below are the app shell. Below 860px `.rs-dashboard-shell` is
// locked to one viewport and `.rs-dashboard-content` becomes the only scroll
// container, so the navigation header stays fixed rather than riding a
// scrolling document. Above it, both are inert and the page scrolls normally
// under the sticky sidebar. The heights live in globals.css because they're
// breakpoint-dependent and inline styles can't carry media queries.

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Animate the existing content node without remounting pages or form state.
    const animation = content.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    return () => animation?.cancel();
  }, [pathname]);
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
          ref={content}
          className="rs-dashboard-content"
          style={{ flex: 1, minWidth: 0 }}
        >
          {children}
        </div>
      </div>
    </RequireAuth>
  );
}
