import type { Metadata } from "next";
import { PublicEntry } from "@/components/checkin/public-entry";

// TASKLIST Phase 4 — the public check-in page. No auth guard: this is the URL
// the entrance-poster QR (Phase 6) points at, opened on the visitor's own
// phone with no login and no app install.

export const metadata: Metadata = {
  title: "Check in — Tibay Gym",
  description: "Scan-to-check-in for Tibay Gym members and guests.",
};

export default function CheckInPage() {
  return <PublicEntry />;
}
