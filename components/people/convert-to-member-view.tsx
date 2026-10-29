"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import Link from "next/link";
import { watchPerson, type Person } from "@/lib/db";
import { ConvertToMemberForm } from "@/components/people/convert-to-member-form";
import { PeopleFormShell } from "@/components/people/people-form-shell";

// Loads one person and hosts the Guest → Member conversion form (TASKLIST
// Phase 9). Reached from `/dashboard/people/[id]/convert`, either via the
// "Convert to member" action on a guest's Person Profile, or via a redirect
// from the "new profile" form when the entered phone matches an existing
// guest.

interface ConvertToMemberViewProps {
  personId: string;
}

type LoadState =
  | { state: "loading" }
  | { state: "not-found" }
  | { state: "error" }
  | { state: "already-member"; person: Person }
  | { state: "ready"; person: Person };

export function ConvertToMemberView({ personId }: ConvertToMemberViewProps) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });

  // A live listener rather than a one-shot load: if a second staff member
  // converts this same guest while this page is open, the already-member
  // guard below catches it the moment it happens instead of only on load.
  useEffect(() => {
    const unsub = watchPerson(
      personId,
      (person) => {
        if (!person) {
          setLoad({ state: "not-found" });
        } else if (person.type === "member") {
          setLoad({ state: "already-member", person });
        } else {
          setLoad({ state: "ready", person });
        }
      },
      (err) => {
        console.error("[ConvertToMemberView] load failed", err);
        setLoad({ state: "error" });
      },
    );
    return unsub;
  }, [personId]);

  if (load.state === "loading") {
    return (
      <PeopleFormShell title="Convert to member">
        <LoadingSkeleton label="Loading profile…" variant="form" count={4} />
      </PeopleFormShell>
    );
  }

  if (load.state === "not-found") {
    return (
      <PeopleFormShell title="Profile not found">
        <p style={mutedText}>
          No profile matches this link.{" "}
          <Link href="/dashboard/people" style={{ color: "var(--rs-accent-text)" }}>
            Back to People
          </Link>
        </p>
      </PeopleFormShell>
    );
  }

  if (load.state === "error") {
    return (
      <PeopleFormShell title="Convert to member">
        <p style={mutedText}>
          Couldn&apos;t load this profile. Check your connection and refresh.
        </p>
      </PeopleFormShell>
    );
  }

  if (load.state === "already-member") {
    return (
      <PeopleFormShell title={`${load.person.name} is already a member`}>
        <p style={mutedText}>
          Nothing to convert.{" "}
          <Link
            href={`/dashboard/people/${load.person.id}`}
            style={{ color: "var(--rs-accent-text)" }}
          >
            View their profile
          </Link>
        </p>
      </PeopleFormShell>
    );
  }

  const { person } = load;

  return (
    <PeopleFormShell title="Convert to member" subtitle="Guest → Member">
      <ConvertToMemberForm person={person} />
    </PeopleFormShell>
  );
}

const mutedText = {
  margin: 0,
  fontSize: 14,
  color: "var(--rs-muted)",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
} as const;
