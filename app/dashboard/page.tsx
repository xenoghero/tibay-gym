"use client";

import { OverviewView } from "@/components/dashboard/overview-view";

// TASKLIST Phase 7 — Admin Dashboard: Overview tab. The signed-in guard and the
// persistent nav chrome live in `app/dashboard/layout.tsx`; this route is just
// the Overview content.
export default function DashboardPage() {
  return <OverviewView />;
}
