"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { PeopleFormShell } from "@/components/people/people-form-shell";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { RequireAuth } from "@/lib/auth/require-auth";
import { EditProfileView } from "@/components/people/edit-profile-view";

// TASKLIST Phase 3 — edit an existing profile (same fields + RFID-conflict
// validation as creation) plus the members-only status override.
export default function EditProfilePage() {
  const params = useParams<{ id: string }>();

  return (
    <RequireAuth>
      <Suspense fallback={<PeopleFormShell title="Edit profile"><LoadingSkeleton label="Loading profile…" variant="form" count={5} /></PeopleFormShell>}>
        <EditProfileView personId={params.id} />
      </Suspense>
    </RequireAuth>
  );
}
