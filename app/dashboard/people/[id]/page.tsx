"use client";

import { useParams } from "next/navigation";
import { PersonProfileView } from "@/components/people/person-profile-view";

// TASKLIST Phase 8 — Admin Dashboard: Person Profile. Read-only detail view with
// force-close / delete actions; edit + status override live on the `/edit`
// child route. The signed-in guard and nav chrome come from the dashboard
// layout.
export default function PersonProfilePage() {
  const params = useParams<{ id: string }>();
  return <PersonProfileView personId={params.id} />;
}
