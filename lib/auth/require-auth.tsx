"use client";

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
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--rs-bg)",
          color: "var(--rs-muted)",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
