// TASKLIST — mobile responsive chrome. Hand-drawn inline SVG so the bottom nav
// needs no icon dependency. Every icon is a 24-box, drawn with `currentColor`
// so the caller controls colour, and ships two weights:
//
//   filled={false} → stroked outline, used for inactive tabs
//   filled={true}  → solid fill, used for the active tab (Design B's active
//                    treatment is "icon fills solid red", not a pill or rule)
//
// Both weights occupy the same optical area, so a tab doesn't jump when it
// becomes active.

interface IconProps {
  size?: number;
  filled?: boolean;
}

const BASE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

/** Overview — a four-pane grid. */
export function IconOverview({ size = 22, filled = false }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1" fill={filled ? "currentColor" : "none"} />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" fill={filled ? "currentColor" : "none"} />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" fill={filled ? "currentColor" : "none"} />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}

/** People — a primary figure with a second shoulder behind it. */
export function IconPeople({ size = 22, filled = false }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="9.5" cy="8" r="3.5" fill={filled ? "currentColor" : "none"} />
      <path
        d="M3.5 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"
        fill={filled ? "currentColor" : "none"}
      />
      <path d="M17 11.5a3 3 0 1 0-2-5.3" />
      <path d="M18 14.6c1.7.6 2.9 2.2 2.9 4.2" />
    </svg>
  );
}

/** Statistics — three ascending bars. */
export function IconStatistics({ size = 22, filled = false }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <rect x="3.5" y="13" width="4.5" height="7.5" rx="1" fill={filled ? "currentColor" : "none"} />
      <rect x="9.75" y="8" width="4.5" height="12.5" rx="1" fill={filled ? "currentColor" : "none"} />
      <rect x="16" y="3.5" width="4.5" height="17" rx="1" fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}

/** More — the overflow affordance that opens the sheet. Always solid dots;
 *  it signals state through colour alone. */
export function IconMore({ size = 22 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={0}>
      <circle cx="5" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="19" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}

/** Print Check-in QR — a QR registration frame. */
export function IconQr({ size = 22 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h3v3h-3zM20.5 20.5h-3v-3" />
      <path d="M14 20.5h.01" />
    </svg>
  );
}

/** Account Settings — a gear. */
export function IconSettings({ size = 22 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1z" />
    </svg>
  );
}

/** Sign out — door with an outbound arrow. */
export function IconSignOut({ size = 20 }: IconProps) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M9.5 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
      <path d="M16 16.5l4.5-4.5L16 7.5" />
      <path d="M20.5 12H9.5" />
    </svg>
  );
}
