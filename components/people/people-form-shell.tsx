import type { ReactNode } from "react";
import { BackLink } from "@/components/people/back-link";

// Centered page frame shared by the create and edit profile routes. Layout
// only — no data. The full People-list chrome (nav, list, search) is Phase 8.

interface PeopleFormShellProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}

export function PeopleFormShell({
  title,
  subtitle,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
  children,
}: PeopleFormShellProps) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--rs-bg)",
        color: "var(--rs-fg)",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        padding: "40px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <BackLink href={backHref} label={backLabel} />

        <h1
          style={{
            fontFamily:
              "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif",
            fontSize: 40,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.01em",
            margin: "14px 0 0",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--rs-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {subtitle}
          </p>
        )}

        <div style={{ marginTop: 28 }}>{children}</div>
      </div>
    </main>
  );
}
