"use client";

import { PeopleView } from "@/components/dashboard/people-view";

// TASKLIST Phase 8 — Admin Dashboard: People tab. The signed-in guard and the
// persistent nav chrome live in `app/dashboard/layout.tsx`; this route is just
// the People list content.
export default function PeoplePage() {
  return <PeopleView />;
}
