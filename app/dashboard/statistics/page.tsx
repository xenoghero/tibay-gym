"use client";

import { StatisticsView } from "@/components/dashboard/statistics-view";

// TASKLIST Phase 10 — Admin Dashboard: Statistics tab. The signed-in guard and
// the persistent nav chrome live in `app/dashboard/layout.tsx`; this route is
// just the Statistics tab content.
export default function StatisticsPage() {
  return <StatisticsView />;
}
