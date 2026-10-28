"use client";

import { RequireAuth } from "@/lib/auth/require-auth";
import { ProfileForm } from "@/components/people/profile-form";
import { PeopleFormShell } from "@/components/people/people-form-shell";

// TASKLIST Phase 3 — create a member or guest profile. Reached for now from the
// dashboard landing link; the People list that will normally link here is
// Phase 8.
export default function NewProfilePage() {
  return (
    <RequireAuth>
      <PeopleFormShell
        title="New profile"
        subtitle="Create a member or guest"
      >
        <ProfileForm mode="create" />
      </PeopleFormShell>
    </RequireAuth>
  );
}
