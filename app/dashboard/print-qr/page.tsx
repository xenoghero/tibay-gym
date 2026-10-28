import type { Metadata } from "next";
import { RequireAuth } from "@/lib/auth/require-auth";
import { PrintQrView } from "@/components/print-qr/print-qr-view";

// TASKLIST Phase 6 — Admin: Print Check-in QR page. Reached for now from the
// dashboard landing link; the persistent dashboard nav that will normally link
// here is Phase 7.

export const metadata: Metadata = {
  title: "Print Check-in QR — Tibay Gym Admin",
  description: "Generate and print the entrance check-in QR poster.",
};

export default function PrintQrPage() {
  return (
    <RequireAuth>
      <PrintQrView />
    </RequireAuth>
  );
}
