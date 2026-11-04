"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { BrandLoading } from "@/components/ui/brand-loading";

/**
 * Client-side route guard. Renders `children` only for a signed-in admin;
 * anyone else is redirected to `/login`. Shows a minimal placeholder while
 * the initial auth state resolves so protected content never flashes.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  // Only guards mounted during restoration wait for a complete logo cycle.
  // Nested guards mounted after restoration can render immediately.
  const [finishingAnimation, setFinishingAnimation] = useState(loading);

  useEffect(() => {
    if (!loading && !user && !finishingAnimation) router.replace("/login");
  }, [loading, user, finishingAnimation, router]);

  if (loading || !user || finishingAnimation) {
    return (
      <BrandLoading label="Loading your dashboard"
        onAnimationIteration={(event) => {
          if (event.target === event.currentTarget && !loading) setFinishingAnimation(false);
        }}
      />
    );
  }

  return <>{children}</>;
}
