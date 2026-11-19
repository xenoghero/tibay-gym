"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { PortalHeader } from "./portal-header";
import { PurchaseForm } from "@/components/people/purchase-form";
import { TopUpPicker } from "./coaching-panel";
import { TIME_SLOTS, WEEKDAYS, type CoachingPackage } from "@/lib/coaching/catalog";
import { philippineDate } from "@/lib/finance/rules";
import portal from "./customer-access.module.css";
import styles from "./coaching-signup.module.css";

const dayNames: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" };
const fieldErrors: Record<string, string> = {
  firstName: "Enter your first name.", lastName: "Enter your last name.", phone: "Enter your 11-digit mobile number, like 09171234567.", rateCategory: "Choose Student or Regular.",
  fbName: "Enter the name on your Facebook account.", startDate: "Choose a start date from today onwards.", weekdays: "Pick at least one weekday.",
  timeSlot: "Pick one time slot.", "optional-too-long": "Keep address, goals and remarks under 500 characters.",
};
const money = (minor: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(minor / 100);
type Form = { firstName: string; lastName: string; phone: string; rateCategory: string; fbName: string; startDate: string; weekdays: string[]; timeSlot: string; address: string; goals: string; remarks: string };
/** A closable message at the top of the screen; one with a title is information, without one an error. */
type Toast = { title?: string; text: string; link?: boolean };
const DETAIL_FIELDS: (keyof Form)[] = ["firstName", "lastName", "phone", "rateCategory", "fbName"];
const STEPS = ["Details", "Schedule", "Payment", "Done"];

function validate(form: Form, today: string) {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.firstName.trim()) errors.firstName = fieldErrors.firstName;
  if (!form.lastName.trim()) errors.lastName = fieldErrors.lastName;
  if (!/^09\d{9}$/.test(form.phone)) errors.phone = fieldErrors.phone;
  if (!form.rateCategory) errors.rateCategory = fieldErrors.rateCategory;
  if (!form.fbName.trim()) errors.fbName = fieldErrors.fbName;
  if (!form.startDate || form.startDate < today) errors.startDate = fieldErrors.startDate;
  if (!form.weekdays.length) errors.weekdays = fieldErrors.weekdays;
  if (!form.timeSlot) errors.timeSlot = fieldErrors.timeSlot;
  return errors;
}

const icon = (path: string, size = 18, width = 2) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
const arrow = icon("M4 12h16m-6-6 6 6-6 6"), check = (size = 16) => icon("m5 12 5 5 9-10", size, 3.5);

/** The one fixed Coaching sign-up link: details, Preferred schedule, then package and payment, then a confirmation. */
export function CoachingSignup() {
  const [form, setForm] = useState<Form>({ firstName: "", lastName: "", phone: "", rateCategory: "", fbName: "", startDate: "", weekdays: [], timeSlot: "", address: "", goals: "", remarks: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [operationId] = useState(() => crypto.randomUUID()), [today] = useState(() => philippineDate(Date.now()));
  const [step, setStep] = useState(1), stepped = useRef(false);
  const [busy, setBusy] = useState(false), [loadFailed, setLoadFailed] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null), [leaving, setLeaving] = useState(false);
  const showToast = (next: Toast) => { setLeaving(false); setToast(next); };
  const [packages, setPackages] = useState<CoachingPackage[] | null>(null), [chosen, setChosen] = useState<CoachingPackage | null>(null);
  const [topUpPriceMinor, setTopUpPriceMinor] = useState(0), [topUpCount, setTopUpCount] = useState(1), [buyingTopUps, setBuyingTopUps] = useState(false);
  const registered = step >= 3;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };
  const goTo = (next: number) => { stepped.current = true; setLeaving(true); setStep(next); };
  // Move focus to the newly opened step so keyboard and screen-reader users land on it.
  useEffect(() => { if (stepped.current) document.getElementById("signup-current")?.focus(); }, [step]);
  useEffect(() => {
    if (!registered) return;
    fetch("/api/customer/coaching").then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); setPackages(data.packages); setTopUpPriceMinor(data.topUpPriceMinor); })
      .catch(() => { setLoadFailed(true); showToast({ text: "Could not load the coaching packages. Refresh to try again." }); });
  }, [registered]);

  const focusFirst = (found: Partial<Record<keyof Form, string>>) => document.getElementById(`signup-${Object.keys(found)[0]}`)?.focus();

  function continueToSchedule(event: FormEvent) {
    event.preventDefault();
    const found = Object.fromEntries(Object.entries(validate(form, today)).filter(([key]) => DETAIL_FIELDS.includes(key as keyof Form)));
    setErrors(found);
    if (Object.keys(found).length) { focusFirst(found); return; }
    goTo(2);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate(form, today);
    setErrors(found); setLeaving(true);
    if (Object.keys(found).length) { if (DETAIL_FIELDS.some(key => found[key])) goTo(1); else focusFirst(found); return; }
    setBusy(true);
    // The profile keeps one name, so first and last name are sent joined.
    const { firstName, lastName, ...rest } = form;
    try {
      const response = await fetch("/api/coaching/signup", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ operationId, ...rest, name: `${firstName.trim()} ${lastName.trim()}`, address: form.address || undefined, goals: form.goals || undefined, remarks: form.remarks || undefined }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) { goTo(3); return; }
      if (result.error === "phone-already-registered") { showToast({ title: "This number already has an account", text: "Log in to the members portal with it and buy coaching from the Coaching tab.", link: true }); return; }
      const invalid = typeof result.error === "string" && result.error.startsWith("signup-invalid-") ? result.error.slice(15) : "";
      const field = invalid === "name" ? "firstName" : invalid;
      const message = fieldErrors[field] ?? (response.status === 429 ? "Too many sign-ups from this device. Please wait and try again." : "Could not sign you up. Check your details and try again.");
      if (DETAIL_FIELDS.includes(field as keyof Form)) { goTo(1); setErrors({ [field]: message }); } else showToast({ text: message });
    } catch { showToast({ text: "Could not reach the gym. Check your connection and try again." }); }
    finally { setBusy(false); }
  }

  const err = (key: keyof Form) => errors[key] && <span className={styles.fieldError} id={`signup-${key}-error`}>{errors[key]}</span>;
  const described = (key: keyof Form) => errors[key] ? { "aria-invalid": true, "aria-describedby": `signup-${key}-error` } : {};
  const heading = (title: string, eyebrow = `Step ${step} of 4`) => <div><span className={styles.eyebrow}>{eyebrow}</span><h2 id="signup-current" tabIndex={-1}>{title}</h2></div>;
  const paid = chosen ? `${chosen.sessions} sessions · ${money(chosen.priceMinor)}` : `${topUpCount} session top-up${topUpCount === 1 ? "" : "s"} · ${money(topUpCount * topUpPriceMinor)}`;
  const schedule = `${form.weekdays.map(day => dayNames[day].slice(0, 3)).join(", ")} · ${TIME_SLOTS[form.timeSlot as keyof typeof TIME_SLOTS] ?? ""}`;

  return <main className={`${portal.portal} ${portal.memberPortal} ${styles.signup}`}>
    <PortalHeader label="Coaching sign-up" href="/coaching" brandLabel="Tibay Gym coaching sign-up"><Link href="/customer" className={portal.backLink}>Members portal ↗</Link></PortalHeader>
    <div className={portal.portalHeading}><h1>One-on-one coaching</h1></div>
    <ol className={styles.rail} aria-label="Sign-up steps">{STEPS.map((label, index) => {
      const n = index + 1, state = n < step || step === 4 ? "done" : n === step ? "current" : "upcoming";
      return <li key={label} data-state={state} aria-current={n === step ? "step" : undefined}>
        <span className={styles.node}>{state === "done" ? check() : n}</span>{label}{state === "done" && <span className={styles.srOnly}> (done)</span>}
      </li>;
    })}</ol>

    {toast && <div key={toast.text} className={styles.toast} data-tone={toast.title ? "info" : "error"} data-leaving={leaving || undefined} role="alert"
      onAnimationEnd={() => { if (leaving) { setToast(null); setLeaving(false); } }}>
      <span className={styles.toastIcon}>{icon("M12 8v5m0 3.5v.5", 16, 2.5)}</span>
      <div>{toast.title && <strong>{toast.title}</strong>}<p>{toast.text}</p>
        {toast.link && <Link href="/customer">Open members portal ↗</Link>}</div>
      <button type="button" aria-label="Dismiss message" onClick={() => setLeaving(true)}>{icon("M6 6l12 12M18 6 6 18")}</button>
    </div>}

    {step === 1 && <form className={styles.form} onSubmit={continueToSchedule} noValidate>
      <p className={styles.lead}>Every coaching package includes one month of gym membership. Your sessions and your month start at your first visit.</p>
      <section className={styles.panel}>
        {heading("Your details")}
        <div className={styles.pair}>
          {/* 60 + space + 59 stays within the server's 120-character name limit. */}
          <label>First name<input id="signup-firstName" autoComplete="given-name" maxLength={60} value={form.firstName} onChange={e => set("firstName", e.target.value)} {...described("firstName")} />{err("firstName")}</label>
          <label>Last name<input id="signup-lastName" autoComplete="family-name" maxLength={59} value={form.lastName} onChange={e => set("lastName", e.target.value)} {...described("lastName")} />{err("lastName")}</label>
        </div>
        <label>Mobile number<input id="signup-phone" inputMode="numeric" autoComplete="tel" maxLength={11} value={form.phone} onChange={e => set("phone", e.target.value.replace(/\D/g, ""))} {...described("phone")} />{err("phone")}</label>
        <div className={styles.group} role="radiogroup" aria-labelledby="signup-category-label" id="signup-rateCategory" tabIndex={-1} {...described("rateCategory")}>
          <span id="signup-category-label">Rate category</span>
          <div className={styles.choices}>{[["student", "Student"], ["regular", "Regular"]].map(([value, label]) => <label key={value} className={styles.choice}>
            <input type="radio" name="rateCategory" value={value} checked={form.rateCategory === value} onChange={() => set("rateCategory", value)} />{label}</label>)}</div>{err("rateCategory")}
        </div>
        <label>Facebook name<input id="signup-fbName" maxLength={120} value={form.fbName} onChange={e => set("fbName", e.target.value)} {...described("fbName")} />{err("fbName")}</label>
        <label>Address <small>(optional)</small><input autoComplete="street-address" maxLength={500} value={form.address} onChange={e => set("address", e.target.value)} /></label>
      </section>
      <div className={styles.actionBar}><button type="submit" className={styles.next}><span>Next: preferred schedule</span>{arrow}</button></div>
    </form>}

    {step === 2 && <form className={styles.form} onSubmit={submit} noValidate>
      <fieldset className={styles.panel} disabled={busy}>
        {heading("Preferred schedule")}
        <label>Start date<input id="signup-startDate" type="date" min={today} value={form.startDate} onChange={e => set("startDate", e.target.value)} {...described("startDate")} />
          <small>A preference only: your package starts at your first visit.</small>{err("startDate")}</label>
        <div className={styles.group} role="group" aria-labelledby="signup-days-label" id="signup-weekdays" tabIndex={-1} {...described("weekdays")}>
          <span id="signup-days-label">Weekdays</span>
          <div className={styles.tiles} data-columns="5">{WEEKDAYS.map(day => <label key={day} className={styles.tile}>
            <input type="checkbox" aria-label={dayNames[day]} checked={form.weekdays.includes(day)} onChange={e => set("weekdays", e.target.checked ? [...form.weekdays, day] : form.weekdays.filter(d => d !== day))} />{dayNames[day].slice(0, 3)}</label>)}</div>{err("weekdays")}
        </div>
        <div className={styles.group} role="radiogroup" aria-labelledby="signup-slot-label" id="signup-timeSlot" tabIndex={-1} {...described("timeSlot")}>
          <span id="signup-slot-label">Time slot</span>
          <div className={styles.tiles}>{Object.entries(TIME_SLOTS).map(([value, label]) => <label key={value} className={styles.tile} data-kind="slot">
            <input type="radio" name="timeSlot" value={value} checked={form.timeSlot === value} onChange={() => set("timeSlot", value)} />{value.replace(/^./, c => c.toUpperCase())}<small>{label}</small></label>)}</div>{err("timeSlot")}
        </div>
        <label>Goals <small>(optional)</small><textarea maxLength={500} rows={2} value={form.goals} onChange={e => set("goals", e.target.value)} /></label>
        <label>Remarks <small>(optional)</small><textarea maxLength={500} rows={2} value={form.remarks} onChange={e => set("remarks", e.target.value)} /></label>
      </fieldset>
      <div className={styles.actionBar}>
        <button type="button" className={styles.back} aria-label="Back to your details" disabled={busy} onClick={() => goTo(1)}>{icon("M20 12H4m6-6-6 6 6 6")}</button>
        <button type="submit" className={styles.next} disabled={busy}><span>{busy ? "Saving your details…" : "Save and go to payment"}</span>{arrow}</button>
      </div>
    </form>}

    {step === 3 && <div className={styles.form}>
      <section className={styles.panel}>
        {heading("Choose and pay")}
        {!packages && !loadFailed && <p className={styles.lead}>Loading packages…</p>}
        {packages && <div className={styles.group} role="radiogroup" aria-label="Package">
          {packages.map(item => <label key={item.id} className={styles.packageRow}>
            <input type="radio" name="package" checked={chosen?.id === item.id} onChange={() => { setChosen(item); setBuyingTopUps(false); }} />
            <span><strong>{item.sessions} sessions</strong><small>Valid {item.validityDays} days</small></span><b>{money(item.priceMinor)}</b></label>)}
          <small>Each includes one month of gym membership.</small>
        </div>}
        {chosen && <PurchaseForm portal heading="Pay for your coaching package" key={chosen.id} packageId={chosen.id} onSubmitted={() => goTo(4)} />}
        {packages && topUpPriceMinor > 0 && !chosen && (buyingTopUps ? <div className={portal.purchasePanel}>
          <p className={styles.lead}>{topUpCount} session top-up{topUpCount === 1 ? "" : "s"} · coaching only <button type="button" className={portal.textButton} onClick={() => setBuyingTopUps(false)}>Change</button></p>
          <PurchaseForm portal heading="Pay for your session top-ups" key={`topups-${topUpCount}`} topUpSessions={topUpCount} onSubmitted={() => goTo(4)} />
        </div> : <div>
          <h3 className={styles.subhead}>Or try coaching with session top-ups</h3>
          <TopUpPicker count={topUpCount} onCount={setTopUpCount} priceMinor={topUpPriceMinor} />
          <button type="button" className={portal.secondaryButton} style={{ marginTop: 12 }} onClick={() => setBuyingTopUps(true)}>Buy {topUpCount} top-up{topUpCount === 1 ? "" : "s"} · {money(topUpCount * topUpPriceMinor)}</button>
        </div>)}
      </section>
    </div>}

    {step === 4 && <div className={styles.form}>
      <section className={styles.panel}>
        <span className={styles.doneMark}>{check(26)}</span>
        {heading("Payment sent for review", "All done")}
        <p className={styles.lead}>The gym will check your receipt. Once it is approved, your coaching sessions start at your first visit.</p>
        <dl className={styles.summary}>
          <div><dt>Package</dt><dd>{paid}</dd></div>
          <div><dt>Payment</dt><dd><span className={portal.badge} data-status="pending">Pending review</span></dd></div>
          <div><dt>Schedule</dt><dd>{schedule}</dd></div>
        </dl>
      </section>
      <div className={styles.actionBar}><Link href="/members#coaching" className={styles.next}><span>Open members portal</span>{arrow}</Link></div>
    </div>}
  </main>;
}
