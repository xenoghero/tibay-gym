"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PortalHeader } from "./portal-header";
import { PurchaseForm } from "@/components/people/purchase-form";
import { TopUpPicker } from "./coaching-panel";
import { TIME_SLOTS, WEEKDAYS, type CoachingPackage } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import portal from "./customer-access.module.css";
import styles from "./coaching-signup.module.css";

const dayNames: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" };
const fieldErrors: Record<string, string> = {
  name: "Enter your name.", phone: "Enter your 11-digit mobile number, like 09171234567.", rateCategory: "Choose Student or Regular.",
  fbName: "Enter the name on your Facebook account.", startDate: "Choose a start date from today onwards.", weekdays: "Pick at least one weekday.",
  timeSlot: "Pick one time slot.", "optional-too-long": "Keep address, goals and remarks under 500 characters.",
};
const money = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(minor / 100);
type Form = { name: string; phone: string; rateCategory: string; fbName: string; startDate: string; weekdays: string[]; timeSlot: string; address: string; goals: string; remarks: string };

function validate(form: Form, today: string) {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.name.trim()) errors.name = fieldErrors.name;
  if (!/^09\d{9}$/.test(form.phone)) errors.phone = fieldErrors.phone;
  if (!form.rateCategory) errors.rateCategory = fieldErrors.rateCategory;
  if (!form.fbName.trim()) errors.fbName = fieldErrors.fbName;
  if (!form.startDate || form.startDate < today) errors.startDate = fieldErrors.startDate;
  if (!form.weekdays.length) errors.weekdays = fieldErrors.weekdays;
  if (!form.timeSlot) errors.timeSlot = fieldErrors.timeSlot;
  return errors;
}

/** The one fixed Coaching sign-up link: details and Preferred schedule, then package and payment, then the members portal. */
export function CoachingSignup() {
  const router = useRouter();
  const [form, setForm] = useState<Form>({ name: "", phone: "", rateCategory: "", fbName: "", startDate: "", weekdays: [], timeSlot: "", address: "", goals: "", remarks: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [operationId] = useState(() => crypto.randomUUID()), [today] = useState(() => philippineDate(Date.now()));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [registered, setRegistered] = useState(false), [taken, setTaken] = useState(false);
  const [packages, setPackages] = useState<CoachingPackage[] | null>(null), [chosen, setChosen] = useState<CoachingPackage | null>(null);
  const [topUpPriceMinor, setTopUpPriceMinor] = useState(0), [topUpCount, setTopUpCount] = useState(1), [buyingTopUps, setBuyingTopUps] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };
  useEffect(() => {
    if (!registered) return;
    fetch("/api/customer/coaching").then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); setPackages(data.packages); setTopUpPriceMinor(data.topUpPriceMinor); })
      .catch(() => setError("Could not load the coaching packages. Refresh to try again."));
  }, [registered]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate(form, today);
    setErrors(found); setError(""); setTaken(false);
    if (Object.keys(found).length) { document.getElementById(`signup-${Object.keys(found)[0]}`)?.focus(); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/coaching/signup", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ operationId, ...form, address: form.address || undefined, goals: form.goals || undefined, remarks: form.remarks || undefined }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) { setRegistered(true); return; }
      if (result.error === "phone-already-registered") { setTaken(true); return; }
      const field = typeof result.error === "string" && result.error.startsWith("signup-invalid-") ? result.error.slice(15) : "";
      setError(fieldErrors[field] ?? (response.status === 429 ? "Too many sign-ups from this device. Please wait and try again." : "Could not sign you up. Check your details and try again."));
    } catch { setError("Could not reach the gym. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const err = (key: keyof Form) => errors[key] && <span className={styles.fieldError} id={`signup-${key}-error`}>{errors[key]}</span>;
  const described = (key: keyof Form) => errors[key] ? { "aria-invalid": true, "aria-describedby": `signup-${key}-error` } : {};
  return <main className={`${portal.portal} ${portal.memberPortal}`}>
    <PortalHeader label="Coaching sign-up" href="/coaching" brandLabel="Tibay Gym coaching sign-up"><Link href="/customer" className={portal.backLink}>Members portal ↗</Link></PortalHeader>
    <div className={portal.portalHeading}><h1>One-on-one coaching</h1></div>
    {!registered ? <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.lead}>Every coaching package includes one month of gym membership. Your sessions and your month start at your first visit.</p>
      <fieldset disabled={busy}><legend>Your details</legend>
        <label>Name<input id="signup-name" autoComplete="name" maxLength={120} value={form.name} onChange={e => set("name", e.target.value)} {...described("name")} />{err("name")}</label>
        <label>Mobile number<input id="signup-phone" inputMode="numeric" autoComplete="tel" maxLength={11} value={form.phone} onChange={e => set("phone", e.target.value.replace(/\D/g, ""))} {...described("phone")} />{err("phone")}</label>
        <div className={styles.group} role="radiogroup" aria-labelledby="signup-category-label" id="signup-rateCategory" tabIndex={-1} {...described("rateCategory")}>
          <span id="signup-category-label">Rate category</span>
          <div className={styles.choices}>{[["student", "Student"], ["regular", "Regular"]].map(([value, label]) => <label key={value} className={styles.choice}>
            <input type="radio" name="rateCategory" value={value} checked={form.rateCategory === value} onChange={() => set("rateCategory", value)} />{label}</label>)}</div>{err("rateCategory")}
        </div>
        <label>Facebook name<input id="signup-fbName" maxLength={120} value={form.fbName} onChange={e => set("fbName", e.target.value)} {...described("fbName")} />{err("fbName")}</label>
        <label>Address <small>(optional)</small><input autoComplete="street-address" maxLength={500} value={form.address} onChange={e => set("address", e.target.value)} /></label>
      </fieldset>
      <fieldset disabled={busy}><legend>Preferred schedule</legend>
        <label>Start date<input id="signup-startDate" type="date" min={today} value={form.startDate} onChange={e => set("startDate", e.target.value)} {...described("startDate")} />
          <small>A preference only: your package starts at your first visit.</small>{err("startDate")}</label>
        <div className={styles.group} role="group" aria-labelledby="signup-days-label" id="signup-weekdays" tabIndex={-1} {...described("weekdays")}>
          <span id="signup-days-label">Weekdays</span>
          <div className={styles.choices}>{WEEKDAYS.map(day => <label key={day} className={styles.choice}>
            <input type="checkbox" checked={form.weekdays.includes(day)} onChange={e => set("weekdays", e.target.checked ? [...form.weekdays, day] : form.weekdays.filter(d => d !== day))} />{dayNames[day]}</label>)}</div>{err("weekdays")}
        </div>
        <div className={styles.group} role="radiogroup" aria-labelledby="signup-slot-label" id="signup-timeSlot" tabIndex={-1} {...described("timeSlot")}>
          <span id="signup-slot-label">Time slot</span>
          <div className={styles.choices}>{Object.entries(TIME_SLOTS).map(([value, label]) => <label key={value} className={styles.choice}>
            <input type="radio" name="timeSlot" value={value} checked={form.timeSlot === value} onChange={() => set("timeSlot", value)} />{label}</label>)}</div>{err("timeSlot")}
        </div>
        <label>Goals <small>(optional)</small><textarea maxLength={500} rows={3} value={form.goals} onChange={e => set("goals", e.target.value)} /></label>
        <label>Remarks <small>(optional)</small><textarea maxLength={500} rows={3} value={form.remarks} onChange={e => set("remarks", e.target.value)} /></label>
      </fieldset>
      {taken && <div className={portal.notice} role="alert"><div><strong>This number already has an account</strong><p>Log in to the members portal with it and buy coaching from the Coaching tab.</p></div>
        <Link href="/customer" className={portal.secondaryButton}>Open members portal</Link></div>}
      {error && <p className={portal.error} role="alert">{error}</p>}
      <button type="submit" className={portal.primaryButton} disabled={busy}>{busy ? "Saving your details…" : "Continue to packages"}<span aria-hidden="true">→</span></button>
    </form> : buyingTopUps ? <div className={portal.purchasePanel}>
      <p className={styles.lead}>{topUpCount} session top-up{topUpCount === 1 ? "" : "s"} · coaching only <button type="button" className={portal.textButton} onClick={() => setBuyingTopUps(false)}>Change</button></p>
      <PurchaseForm portal heading="Pay for your session top-ups" key={`topups-${topUpCount}`} topUpSessions={topUpCount} onSubmitted={() => router.push("/members#coaching")} />
    </div> : !chosen ? <section className={portal.paymentPanel} aria-labelledby="signup-packages">
      <div className={portal.sectionHeading}><h2 id="signup-packages">Choose a package</h2></div>
      {!packages && !error && <p className={styles.lead}>Loading packages…</p>}
      {error && <p className={portal.error} role="alert">{error}</p>}
      <ul className={styles.packages}>{packages?.map(item => <li key={item.id}><button type="button" onClick={() => setChosen(item)}>
        <strong>{money(item.priceMinor)}</strong><span>{item.sessions} sessions</span><small>Valid {item.validityDays} days · includes 1 month gym membership</small></button></li>)}</ul>
      {packages && topUpPriceMinor > 0 && <div style={{ marginTop: 24 }}>
        <h3 className={styles.subhead}>Or try coaching with session top-ups</h3>
        <TopUpPicker count={topUpCount} onCount={setTopUpCount} priceMinor={topUpPriceMinor} />
        <button type="button" className={portal.secondaryButton} style={{ marginTop: 12 }} onClick={() => setBuyingTopUps(true)}>Buy {topUpCount} top-up{topUpCount === 1 ? "" : "s"} · {money(topUpCount * topUpPriceMinor)}</button>
      </div>}
    </section> : <div className={portal.purchasePanel}>
      <p className={styles.lead}>{chosen.sessions} coaching sessions · valid {chosen.validityDays} days <button type="button" className={portal.textButton} onClick={() => setChosen(null)}>Change</button></p>
      <PurchaseForm portal heading="Pay for your coaching package" key={chosen.id} packageId={chosen.id} onSubmitted={() => router.push("/members#coaching")} />
    </div>}
  </main>;
}
