"use client";

import { AccountSettingsView } from "@/components/dashboard/account-settings-view";

// TASKLIST Phase 11 — Admin: Account Settings. The signed-in guard and the
// persistent nav chrome live in `app/dashboard/layout.tsx`; this route is
// just the Account Settings tab content.
export default function AccountSettingsPage() {
  return <AccountSettingsView />;
}
