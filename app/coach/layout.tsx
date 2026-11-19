import type { ReactNode } from "react";
import { CoachShell } from "./coach-shell";

export const metadata = { title: "Coach portal — Tibay Gym", description: "Your coaching clients and sessions at Tibay Gym." };
export default function CoachLayout({ children }: { children: ReactNode }) { return <CoachShell>{children}</CoachShell>; }
