"use client";
import { FormSelect } from "@/components/ui/form-select";
import styles from "./entry.module.css";
import { LEAD_SOURCES } from "@/lib/registration";
export function RegistrationInputs({ category, source, other, onCategory, onSource, onOther, disabled = false, requireSource = true, choiceTiles = false }: {
  category: string; source: string; other: string; onCategory(value: string): void; onSource(value: string): void; onOther(value: string): void;
  disabled?: boolean; requireSource?: boolean; choiceTiles?: boolean;
}) {
  const style = { minHeight: 44, width: "100%", padding: 10, fontSize: 16, border: "1px solid #bbb", borderRadius: 5 };
  return <div className={styles.registration}>
    {choiceTiles ? <fieldset className={styles.choices} disabled={disabled}>
      <legend>Rate category</legend>
      <div className={styles.choiceGrid}>
        {(["student", "regular"] as const).map(value => <label className={styles.choice} key={value}>
          <input type="radio" name="rate-category" value={value} required checked={category === value} onChange={() => onCategory(value)} />
          <span><strong>{value === "student" ? "Student" : "Regular"}</strong>{" "}<small>{value === "student" ? "Student rate category" : "Standard rate category"}</small></span>
        </label>)}
      </div>
    </fieldset> : <label style={{ display: "grid", gap: 6 }}>Rate category
      <FormSelect className={styles.select} aria-label="Rate category" required disabled={disabled} value={category} onChange={e => onCategory(e.target.value)}>
        <option value="">Choose Student / Regular</option><option value="student">Student</option><option value="regular">Regular</option>
      </FormSelect>
    </label>}
    {requireSource && <label style={{ display: "grid", gap: 6 }}>Where did you know Tibay Gym?
      <FormSelect className={styles.select} aria-label="Where did you know Tibay Gym?" required disabled={disabled} value={source} onChange={e => onSource(e.target.value)}>
        <option value="">Choose a source</option>{LEAD_SOURCES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </FormSelect>
    </label>}
    {requireSource && source === "others" && <label style={{ display: "grid", gap: 6 }}>Other source details
      <input aria-label="Other source details" required maxLength={300} value={other} disabled={disabled} onChange={e => onOther(e.target.value)} style={style} />
    </label>}
  </div>;
}
