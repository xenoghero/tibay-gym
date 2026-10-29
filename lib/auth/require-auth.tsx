"use client";

import { LoadingSkeleton } from "@/components/ui/skeleton";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * Client-side route guard. Renders `children` only for a signed-in admin;
 * anyone else is redirected to `/login`. Shows a minimal placeholder while
 * the initial auth state resolves so protected content never flashes.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div style={{ minHeight: "100vh", padding: "clamp(24px, 6vw, 80px)", background: "var(--rs-bg)" }}>
        <LoadingSkeleton label="Loading your workspace…" variant="cards" count={4} />
        <LoadingSkeleton label="Checking sign-in…" count={5} />
      </div>
    );
  }

  return <>{children}</>;
}
