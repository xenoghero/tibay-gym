"use client";

import { useParams } from "next/navigation";
import { RequireAuth } from "@/lib/auth/require-auth";
import { ConvertToMemberView } from "@/components/people/convert-to-member-view";

// TASKLIST Phase 9 — Guest → Member Conversion.
export default function ConvertToMemberPage() {
  const params = useParams<{ id: string }>();

  return (
    <RequireAuth>
      <ConvertToMemberView personId={params.id} />
    </RequireAuth>
  );
}
