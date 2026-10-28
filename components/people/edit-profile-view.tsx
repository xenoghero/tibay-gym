"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getPerson,
  getProfileDetails,
  type Person,
  type ProfileDetails,
} from "@/lib/db";
import { ProfileForm } from "@/components/people/profile-form";
import { StatusOverride } from "@/components/people/status-override";
import { PeopleFormShell } from "@/components/people/people-form-shell";

// Loads one person and hosts the edit form plus the members-only status
// override (TASKLIST Phase 3). Reached from `/dashboard/people/[id]/edit`.

interface EditProfileViewProps {
  personId: string;
}

type LoadState =
  | { state: "loading" }
  | { state: "not-found" }
  | { state: "error" }
  | {
      state: "ready";
      person: Person;
      profileDetails: ProfileDetails | null;
    };

export function EditProfileView({ personId }: EditProfileViewProps) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const searchParams = useSearchParams();
  const justCreated = searchParams.get("created") === "1";
  const profileHref = `/dashboard/people/${personId}`;

  const computeLoadState = useCallback(async (): Promise<LoadState> => {
    try {
      const person = await getPerson(personId);
      if (!person) return { state: "not-found" };
      const profileDetails = await getProfileDetails(personId);
      return { state: "ready", person, profileDetails };
    } catch (err) {
      console.error("[EditProfileView] load failed", err);
      return { state: "error" };
    }
  }, [personId]);

  const refetch = useCallback(async () => {
    setLoad(await computeLoadState());
  }, [computeLoadState]);

  useEffect(() => {
    let active = true;
    computeLoadState().then((next) => {
      if (active) setLoad(next);
    });
    return () => {
      active = false;
    };
  }, [computeLoadState]);

  if (load.state === "loading") {
    return (
      <PeopleFormShell
        title="Edit profile"
        backHref={profileHref}
        backLabel="Back to profile"
      >
        <p style={mutedText}>Loading…</p>
      </PeopleFormShell>
    );
  }

  if (load.state === "not-found") {
    return (
      <PeopleFormShell
        title="Profile not found"
        backHref={profileHref}
        backLabel="Back to profile"
      >
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
      <PeopleFormShell
        title="Edit profile"
        backHref={profileHref}
        backLabel="Back to profile"
      >
        <p style={mutedText}>
          Couldn&apos;t load this profile. Check your connection and refresh.
        </p>
      </PeopleFormShell>
    );
  }

  const { person, profileDetails } = load;

  return (
    <PeopleFormShell
      title={`Edit — ${person.name}`}
      subtitle={person.type === "member" ? "Member profile" : "Guest profile"}
      backHref={profileHref}
      backLabel="Back to profile"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {justCreated && (
          <div
            role="status"
            style={{
              padding: "10px 12px",
              background: "var(--rs-panel)",
              borderLeft: "2px solid var(--rs-muted)",
              fontSize: 13,
              color: "var(--rs-muted)",
            }}
          >
            Profile created. You can add or adjust details below.
          </div>
        )}

        <ProfileForm
          mode="edit"
          person={person}
          profileDetails={profileDetails}
          onSaved={refetch}
        />

        <StatusOverride person={person} onChanged={refetch} />
      </div>
    </PeopleFormShell>
  );
}

const mutedText = {
  margin: 0,
  fontSize: 14,
  color: "var(--rs-muted)",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
} as const;
