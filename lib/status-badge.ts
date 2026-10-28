import type { CSSProperties } from "react";

// Shared status pill for every admin surface that shows where a member stands —
// the Overview feed, the People roster, the Person profile header, the
// Statistics tables, and the manual status override.
//
// Solid fill on purpose: standing is the single thing front-desk staff scan
// for, so "Active" / "Expired" now carry a saturated background and
// mono/uppercase lettering instead of the faint tinted chip they used to be.
// `guest` stays deliberately recessive — in the Overview feed that slot holds a
// visit count, not an alert — so it reads as a neutral outline, not a state.

export type StatusBadgeKind = "active" | "expired" | "guest";

// No green token in the palette (globals.css is yellow/neutral only); the public
// check-in receipt pins this same hex, so the two stay in step.
const ACTIVE_GREEN = "#1c6b3c";

const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifySelf: "start",
  padding: "4px 10px",
  borderRadius: 4,
  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

export function statusBadgeStyle(kind: StatusBadgeKind): CSSProperties {
  if (kind === "active") {
    return { ...badgeBase, background: ACTIVE_GREEN, color: "#ffffff" };
  }
  if (kind === "expired") {
    return { ...badgeBase, background: "var(--rs-accent)", color: "var(--rs-on-accent)" };
  }
  return {
    ...badgeBase,
    background: "var(--rs-panel)",
    color: "var(--rs-muted)",
    boxShadow: "inset 0 0 0 1px var(--rs-line)",
  };
}

/**
 * Neutral companion pill for the Member / Guest type. Same geometry as the
 * status pill so the two sit together cleanly in the Person profile header;
 * inverse (foreground) fill keeps it clearly subordinate to the coloured
 * status pill beside it.
 */
export function typeBadgeStyle(): CSSProperties {
  return {
    ...badgeBase,
    background: "var(--rs-fg)",
    color: "var(--rs-bg)",
  };
}
