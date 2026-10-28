"use client";

import { useParams } from "next/navigation";
import { RequireAuth } from "@/lib/auth/require-auth";
import { RenewMembershipView } from "@/components/people/renew-membership-view";

export default function RenewMembershipPage() {
  const params = useParams<{ id: string }>();
  return <RequireAuth><RenewMembershipView personId={params.id} /></RequireAuth>;
}
