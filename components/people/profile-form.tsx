"use client";

import { FormInput } from "@/components/ui/form-input";

import {
  useMemo,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Timestamp } from "firebase/firestore";
import { RegistrationInputs } from "@/components/checkin/registration-fields";
import { registrationFields } from "@/lib/registration";
import { NewProfilePurchaseQuote } from "./purchase-form";
import type { PurchaseQuote } from "@/lib/server/purchases";
import {
  createPersonWithProfileDetails,
  effectiveMemberStatus,
  findPersonByPhone,
  updatePersonWithProfileDetails,
  type MemberStatus,
  type Person,
  type PersonInput,
  type PersonType,
  type ProfileDetails,
} from "@/lib/db";
import {
  fromDateInputValue,
  toDateInputValue,
  todayDateInputValue,
} from "@/lib/dates";

// Shared create/edit profile form (TASKLIST Phase 3). One component drives both
// flows: `mode="create"` writes a new person and redirects into its edit page;
// `mode="edit"` saves editable fields in place. Phone uniqueness is checked
// in both modes. RFID ownership is managed separately on the person profile.
// Phase 13 adds the optional private ProfileDetails fields to the same form;
// admin saves write Person + ProfileDetails atomically.

const displayFont =
  "var(--font-barlow-condensed), 'Barlow Condensed', sans-serif";
const bodyFont = "var(--font-geist-sans), system-ui, sans-serif";

type FieldKey =
  | "name"
  | "phone"
  | "birthDate"
  | "membershipExpiry"
  | "joinDate";
type FieldErrors = Partial<Record<FieldKey, string>>;

interface ProfileFormProps {
  mode: "create" | "edit";
  /** Required when `mode="edit"` — the person being edited. */
  person?: Person;
  /** Optional for legacy profiles whose companion document does not exist. */
  profileDetails?: ProfileDetails | null;
  /** Called after a successful edit save (create redirects instead). */
  onSaved?: () => void;
}

export function ProfileForm({
  mode,
  person,
  profileDetails,
  onSaved,
}: ProfileFormProps) {
  const router = useRouter();

  const [type, setType] = useState<PersonType>(person?.type ?? "member");
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [birthDate, setBirthDate] = useState(
    toDateInputValue(profileDetails?.birthDate ?? null),
  );
  const [address, setAddress] = useState(profileDetails?.address ?? "");
  const [category, setCategory] = useState<string>(person?.rateCategory ?? "");
  const [source, setSource] = useState<string>(person?.leadSource ?? "");
  const [other, setOther] = useState(person?.leadSourceOther ?? "");
  const [purchaseQuote, setPurchaseQuote] = useState<PurchaseQuote | null>(null), [correctionReason, setCorrectionReason] = useState("");
  const [membershipExpiry, setMembershipExpiry] = useState(
    toDateInputValue(person?.membershipExpiry ?? null),
  );
  const [joinDate, setJoinDate] = useState(
    mode === "edit"
      ? toDateInputValue(person?.joinDate ?? null)
      : todayDateInputValue(),
  );

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingPerson, setExistingPerson] = useState<Person | null>(null);
  const [lookupError, setLookupError] = useState(false);

  useEffect(() => {
    if (mode !== "create" || !phone.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findPersonByPhone(phone.trim()).then((match) => {
        if (!cancelled) { setExistingPerson(match); setLookupError(false); }
      }).catch(() => { if (!cancelled) setLookupError(true); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [mode, phone]);
  const phoneMatch = existingPerson?.phone === phone.trim() ? existingPerson : null;

  const isMember = type === "member";

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "Enter a name.";
    if (!phone.trim()) errors.phone = "Enter a phone number.";
    if (isMember && mode === "edit" && !membershipExpiry) {
      errors.membershipExpiry = "Pick a membership expiry date.";
    }
    if (isMember && mode === "edit" && !joinDate) errors.joinDate = "Pick a join date.";
    if (birthDate && !fromDateInputValue(birthDate)) {
      errors.birthDate = "Enter a valid birth date.";
    }
    return errors;
  }

  /**
   * On create, initial standing is derived from the expiry date. On edit, an
   * existing member's effective standing is preserved — derived from
   * `membershipExpiry` rather than the raw stored `status`, so a save doesn't
   * perpetuate a stale "active" past an expiry date that's already lapsed
   * (the split-brain the Statistics Membership Expiry Watch otherwise catches
   * alone). A manual override still isn't reset by an unrelated field edit,
   * since `effectiveMemberStatus` only overrides to "expired" once the date
   * has actually passed.
   */
  function resolveStatus(expiry: Timestamp | null): MemberStatus | null {
    if (!isMember) return null;
    if (mode === "edit" && person?.type === "member" && person.status) {
      return effectiveMemberStatus(person);
    }
    if (!expiry) return "expired";
    return expiry.toMillis() >= Date.now() ? "active" : "expired";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSavedNotice(null);
    if (mode === "create" && phoneMatch) {
      router.push(`/dashboard/people/${phoneMatch.id}/${phoneMatch.type === "member" ? "renew" : "convert"}`);
      return;
    }

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    const trimmedPhone = phone.trim();

    try {
      const registration = mode === "create" ? registrationFields({ rateCategory: category, leadSource: source, leadSourceOther: other }) : null;
      // Recheck uniqueness before creating. Existing profiles go straight to
      // renewal/conversion; editing cannot take another person's phone number.
      const phoneMatch = await findPersonByPhone(trimmedPhone);
      if (phoneMatch && phoneMatch.id !== person?.id) {
        if (mode === "create") {
          router.push(`/dashboard/people/${phoneMatch.id}/${phoneMatch.type === "member" ? "renew" : "convert"}`);
          return;
        }
        setFieldErrors({
          phone: `A profile with this phone number already exists — ${phoneMatch.name}.`,
        });
        setSubmitting(false);
        return;
      }

      const expiryTs = isMember ? fromDateInputValue(membershipExpiry) : null;
      const joinTs = isMember ? fromDateInputValue(joinDate) : null;
      const birthDateTs = fromDateInputValue(birthDate);

      const input: PersonInput = {
        phone: trimmedPhone,
        name: name.trim(),
        type,
        status: resolveStatus(expiryTs),
        membershipExpiry: expiryTs,
        joinDate: joinTs,
        ...(registration ?? (category === "student" || category === "regular" ? { rateCategory: category } : {})),
      };
      const privateDetails = {
        birthDate: birthDateTs,
        address: address.trim() || null,
      };

      if (mode === "create") {
        if (isMember && (!purchaseQuote || purchaseQuote.categorySnapshot !== category)) throw new Error("Review a configured monthly price before creating a membership request.");
        const id = await createPersonWithProfileDetails(input, privateDetails, isMember && purchaseQuote ? { quoteToken: purchaseQuote.quoteToken, ...(purchaseQuote.voucherSnapshot ? { voucherCode: purchaseQuote.voucherSnapshot.code } : {}) } : undefined);
        router.push(isMember ? "/dashboard/payments" : `/dashboard/people/${id}/edit?created=1`);
        return;
      }

      await updatePersonWithProfileDetails(person!.id, input, privateDetails, correctionReason);
      setSavedNotice("Profile saved.");
      onSaved?.();
    } catch (err) {
      console.error("[ProfileForm] save failed", err);
      setFormError(err instanceof Error ? err.message : "Could not confirm the profile change. Retry the same action.");
    } finally {
      setSubmitting(false);
    }
  }

  const typeOptions = useMemo(
    () => [
      { value: "member" as const, label: "Member" },
      { value: "guest" as const, label: "Guest" },
    ],
    [],
  );

  return (
    <form onSubmit={handleSubmit} style={{ fontFamily: bodyFont }} noValidate>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>Profile type</span>
          <div
            role="radiogroup"
            aria-label="Profile type"
            style={{ display: "inline-flex", border: "1px solid var(--rs-line)", borderRadius: 6, overflow: "hidden", width: "fit-content" }}
          >
            {typeOptions.map((opt) => {
              const active = type === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setType(opt.value)}
                  style={{
                    padding: "9px 20px",
                    border: "none",
                    background: active ? "var(--rs-accent)" : "transparent",
                    color: active ? "var(--rs-on-accent)" : "var(--rs-fg)",
                    fontFamily: displayFont,
                    fontSize: 15,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {mode === "edit" && person?.type === "guest" && type === "member" && (
            <p style={hintStyle}>
              Use the dedicated{" "}
              <a href={`/dashboard/people/${person!.id}/convert`} style={{ color: "var(--rs-accent-text)" }}>
                Convert to member
              </a>{" "}
              flow instead — it keeps this person&apos;s prior visit history and
              only asks for the new membership fields.
            </p>
          )}
        </div>

        <Field
          id="name"
          label="Name"
          value={name}
          onChange={setName}
          error={fieldErrors.name}
          autoComplete="name"
        />

        <RegistrationInputs category={category} source={source} other={other} onCategory={value => { setCategory(value); setPurchaseQuote(null); }} onSource={setSource} onOther={setOther} disabled={submitting} requireSource={mode === "create"} />
        {mode === "edit" && !category && <p style={hintStyle}>This existing customer is unclassified. Choose Student / Regular before recording a purchase.</p>}

        <Field
          id="phone"
          label="Phone number"
          value={phone}
          onChange={setPhone}
          error={fieldErrors.phone}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          hint="Used as the unique key for check-in lookup."
        />
        {mode === "create" && phoneMatch && (
          <div role="status" style={alertStyle}>
            <strong>{phoneMatch.name}</strong> already has a profile ({phoneMatch.phone}).{" "}
            <a href={`/dashboard/people/${phoneMatch.id}/${phoneMatch.type === "member" ? "renew" : "convert"}`} style={{ color: "inherit" }}>
              {phoneMatch.type === "member" ? "Renew membership" : "Add membership"}
            </a>
          </div>
        )}
        {mode === "create" && lookupError && <p role="status" style={hintStyle}>Couldn&apos;t check for an existing profile. Saving will check again.</p>}

        <div style={privateDetailsSectionStyle}>
          <div>
            <h2 style={sectionHeadingStyle}>Profile details</h2>
            <p style={hintStyle}>
              Optional and visible only to the admin. Age is calculated from the
              birth date when the profile is viewed.
            </p>
          </div>

          <Field
            id="birthDate"
            label="Birth date"
            type="date"
            value={birthDate}
            onChange={setBirthDate}
            error={fieldErrors.birthDate}
          />

          <TextAreaField
            id="address"
            label="Address"
            value={address}
            onChange={setAddress}
            hint="Optional."
          />
        </div>

        <p style={hintStyle}>RFID is optional. Manage cards from the person’s profile after saving.</p>

        {isMember && mode === "create" && <NewProfilePurchaseQuote key={category} category={category} onQuote={setPurchaseQuote} disabled={submitting} />}
        {isMember && mode === "edit" && (
          <>
            <Field
              id="membershipExpiry"
              label="Membership expiry date"
              type="date"
              value={membershipExpiry}
              onChange={setMembershipExpiry}
              error={fieldErrors.membershipExpiry}
            />

            <Field
              id="joinDate"
              label="Join date"
              type="date"
              value={joinDate}
              onChange={setJoinDate}
              error={fieldErrors.joinDate}
              hint="Defaults to today."
            />
            <Field id="membershipCorrectionReason" label="Reason for any membership date/status correction" value={correctionReason} onChange={setCorrectionReason} hint="Use the purchase/renewal workflow for paid extensions. A manual correction is audited and does not record a sale." />
          </>
        )}

        {formError && (
          <div role="alert" style={alertStyle}>
            {formError}
          </div>
        )}
        {savedNotice && (
          <div role="status" style={noticeStyle}>
            {savedNotice}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              height: 44,
              padding: "0 22px",
              border: "none",
              borderRadius: 6,
              background: "var(--rs-accent)",
              color: "var(--rs-on-accent)",
              fontFamily: displayFont,
              fontSize: 16,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              cursor: submitting ? "wait" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting
              ? "Saving…"
              : mode === "create"
                ? phoneMatch ? (phoneMatch.type === "member" ? "Renew membership" : "Add membership") : "Create profile"
                : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() =>
              router.push(
                mode === "edit" && person
                  ? `/dashboard/people/${person.id}`
                  : "/dashboard/people",
              )
            }
            style={{
              height: 44,
              padding: "0 18px",
              border: "1px solid var(--rs-line)",
              borderRadius: 6,
              background: "transparent",
              color: "var(--rs-fg)",
              fontFamily: bodyFont,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

// --- Field --------------------------------------------------------------------

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  type?: string;
  inputMode?: "text" | "tel" | "numeric";
  autoComplete?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  inputMode,
  autoComplete,
}: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <FormInput
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        style={{
          height: 44,
          padding: "0 12px",
          border: `1px solid ${error ? "var(--rs-accent)" : "var(--rs-line)"}`,
          borderRadius: 6,
          background: "var(--rs-bg)",
          color: "var(--rs-fg)",
          outline: "none",
          fontFamily: bodyFont,
          fontSize: 14,
        }}
      />
      {hint && !error && <p id={`${id}-help`} style={hintStyle}>{hint}</p>}
      {error && (
        <p id={`${id}-help`} role="alert" style={{ ...hintStyle, color: "var(--rs-accent-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

interface TextAreaFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  hint,
}: TextAreaFieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={textAreaStyle}
      />
      {hint && <p style={hintStyle}>{hint}</p>}
    </div>
  );
}

// --- shared styles ----------------------------------------------------------

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--rs-fg)",
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "var(--rs-muted)",
  lineHeight: 1.5,
};

const alertStyle: CSSProperties = {
  padding: "10px 12px",
  background: "var(--rs-accent-soft)",
  borderLeft: "2px solid var(--rs-accent)",
  fontSize: 13,
  color: "var(--rs-accent-text)",
};

const noticeStyle: CSSProperties = {
  padding: "10px 12px",
  background: "var(--rs-panel)",
  borderLeft: "2px solid var(--rs-muted)",
  fontSize: 13,
  color: "var(--rs-muted)",
};

const privateDetailsSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: "18px 16px",
  border: "1px solid var(--rs-line)",
  borderRadius: 8,
  background: "var(--rs-panel)",
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: displayFont,
  fontSize: 20,
  fontWeight: 600,
  textTransform: "uppercase",
};

const textAreaStyle: CSSProperties = {
  minHeight: 92,
  padding: "11px 12px",
  border: "1px solid var(--rs-line)",
  borderRadius: 6,
  background: "var(--rs-bg)",
  color: "var(--rs-fg)",
  outline: "none",
  fontFamily: bodyFont,
  fontSize: 14,
  lineHeight: 1.5,
  resize: "vertical",
};
