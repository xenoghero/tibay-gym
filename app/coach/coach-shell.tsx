"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { coachProfile } from "@/lib/auth/staff-home";
import { BrandLoading } from "@/components/ui/brand-loading";
import { DashboardNav, type NavItem } from "@/components/dashboard/dashboard-nav";
import { IconAccount, IconCalendar, IconCoaching } from "@/components/dashboard/nav-icons";

export interface CoachProfile { id: string; name: string; email: string }
const COACH_NAV: NavItem[] = [
  { label: "Schedule", href: "/coach", Icon: IconCalendar },
  { label: "Clients", href: "/coach/clients", Icon: IconCoaching },
  { label: "Account", href: "/coach/account", Icon: IconAccount },
];
const CoachContext = createContext<{ user: User; profile: CoachProfile } | null>(null);
export const useCoach = () => useContext(CoachContext)!;

/** The admin dashboard's shell for an active coach; anyone else goes back through the shared login routing. */
export function CoachShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    let active = true;
    coachProfile(user).then(found => { if (!active) return; if (found) setProfile(found); else router.replace("/dashboard"); })
      .catch(() => { if (active) router.replace("/login"); });
    return () => { active = false; };
  }, [user, loading, router]);
  if (!user || !profile) return <BrandLoading label="Loading the coach portal" fullscreen />;
  return <CoachContext.Provider value={{ user, profile }}>
    <div className="rs-dashboard-shell" style={{ display: "flex", background: "var(--rs-bg)", color: "var(--rs-fg)" }}>
      <DashboardNav items={COACH_NAV} name={profile.name} role="Coach" />
      <div className="rs-dashboard-content" style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  </CoachContext.Provider>;
}
