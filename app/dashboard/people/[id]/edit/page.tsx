"use client";

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
      <Suspense fallback={null}>
        <EditProfileView personId={params.id} />
      </Suspense>
    </RequireAuth>
  );
}
