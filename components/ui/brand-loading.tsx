import type { AnimationEventHandler } from "react";
import { BrandLogo } from "@/components/brand-logo";
import styles from "./brand-loading.module.css";

export function BrandLoading({ label = "Opening membership payment…", fullscreen = false, onAnimationIteration }: {
  label?: string;
  fullscreen?: boolean;
  onAnimationIteration?: AnimationEventHandler<HTMLDivElement>;
}) {
  return <div role="status" aria-label={label} aria-busy="true" className={`${styles.loading} ${fullscreen ? styles.fullscreen : ""}`}>
    <div aria-hidden="true" className={styles.logo} onAnimationIteration={onAnimationIteration}>
      <BrandLogo sidebar />
    </div>
  </div>;
}
