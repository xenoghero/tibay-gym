import type { CSSProperties } from "react";
import styles from "./skeleton.module.css";

/** Decorative placeholder. Use LoadingSkeleton to announce a whole loading region. */
export function Skeleton({ width = "100%", height = 16 }: { width?: CSSProperties["width"]; height?: CSSProperties["height"] }) {
  return <span className={styles.bone} style={{ width, height }} aria-hidden="true" />;
}

/** Keep page chrome outside this region so only unavailable data is replaced. */
export function LoadingSkeleton({ label = "Loading…", variant = "rows", count = 3 }: {
  label?: string;
  variant?: "rows" | "form" | "cards" | "chart" | "profile" | "image" | "inline";
  count?: number;
}) {
  return <div className={styles.region} role="status" aria-busy="true" aria-label={label}>
    <span className={styles.srOnly}>{label}</span>
    <div className={styles[variant]} aria-hidden="true">
      {variant === "inline" && <Skeleton width={120} height={4} />}
      {variant === "profile" && <div className={styles.identity}><Skeleton width={72} height={72} /><div><Skeleton width="55%" height={28} /><Skeleton width="35%" /></div></div>}
      {Array.from({ length: variant === "inline" ? 0 : count }, (_, index) => <div className={styles.item} key={index}>
        <Skeleton width={variant === "form" ? "30%" : "65%"} height={variant === "cards" ? 14 : 16} />
        <Skeleton width={variant === "form" ? "100%" : "85%"} height={variant === "form" ? 44 : variant === "cards" ? 36 : 14} />
        {variant !== "form" && <Skeleton width="40%" height={12} />}
      </div>)}
    </div>
  </div>;
}
