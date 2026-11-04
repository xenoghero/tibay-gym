import styles from "./entry.module.css";

export interface CheckinStep {
  label: string;
  accessibleLabel?: string;
  onSelect?: () => void;
}

export function CheckinSteps({ steps, current, disabled }: { steps: CheckinStep[]; current: number; disabled: boolean }) {
  return <nav className={styles.progressSteps} aria-label="Check-in steps">
    <ol>{steps.map((step, index) => <li key={step.label} data-state={index < current ? "complete" : index === current ? "current" : "upcoming"}>
      {index === current ? <span className={styles.currentStep} aria-current="step"><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>{step.label}</span> :
        <button type="button" disabled={disabled || index > current || !step.onSelect} onClick={step.onSelect}
          aria-label={`Step ${index + 1}: ${step.accessibleLabel ?? step.label}`}>
          <span className={styles.stepNumber} aria-hidden="true">{index < current ? "✓" : index + 1}</span>{step.label}
        </button>}
    </li>)}</ol>
  </nav>;
}
