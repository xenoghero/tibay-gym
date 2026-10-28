# Tibay Gym — Collections, Customer Self-Service, and SMS Extensions
### Project Plan

---

## 1. Overview

Extend the existing Tibay Gym system with the missing collections, payment review, customer registration and renewal, audit, and SMS capabilities. The public customer pages and private administrator dashboard share the existing gym backend; existing attendance, profiles, membership renewal dates, RFID management, and weight tracking remain foundations to preserve. Keep financial charges, payment confirmation, membership entitlement, and attendance separate so a pending payment does not falsely confirm money received or block an allowed daily visit.

This plan covers only missing features and additions to partially implemented features, based on the repository reviewed on October 25, 2026. The supplied scope proposal is reference material; decisions confirmed in the conversation take precedence, including customer access, payment approval, inactivity SMS, and text blasts that extend the original proposal. This is a project plan, not the phased TASKLIST or authorization to implement.

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Web application | Existing Next.js 16.3.3, React 19, and TypeScript application |
| Interface styling | Existing CSS and component conventions |
| Gym records and financial workflow | Existing Firebase Firestore, extended with charges, payment reviews, settings, and audit events |
| Administrator authentication | Existing Firebase email/password authentication and administrator authorization |
| Customer access | Phone-number entry without OTP, as requested; restricted server-issued customer session |
| Receipt storage and metadata | Existing Supabase connection; private Storage objects and Postgres receipt/OCR metadata |
| Profile pictures | Proposed private Supabase Storage objects with authorized image access |
| Receipt OCR | Tesseract; execution package and hosting compatibility to be selected during implementation |
| Background processing | Retryable server jobs for OCR and approval completion; scheduled SMS checks in the final build stages |
| SMS provider | Owner-selected Android SMS Gateway; local implementation complete, credentials/device/SIM activation deferred |
| Verification | Existing Vitest, lint, and production build checks, with targeted financial and workflow tests |

Read the installed Next.js guides before implementation. No replacement framework, ORM, database migration of existing gym records, or provider selection is included in this plan.

## 3. Core Features

### Rates and Customer Registration

- **Student / Regular category** — add a required rate category to new customer registration and administrator-created profiles, independently of Member / Guest type.
- **Configurable pricing** — manage daily and monthly prices in Admin Settings; initial daily prices are PHP 60 Student and PHP 70 Regular, while monthly prices remain unset until configured.
- **Price validation** — prevent membership purchase submission with an unset applicable rate; do not silently interpret an unset monthly price as zero.
- **Historical pricing** — preserve category, applied rate, coverage, and final amount on each charge so subsequent settings changes do not rewrite history.
- **Registration entry choice** — begin the public page with Create Account or Check In, reusing existing phone lookup and visitor approval behavior.
- **Profile picture option** — allow optional image selection/upload during registration and display the saved image in the customer profile.
- **Required lead source** — ask “Where did you know Tibay Gym?” with Ads, Facebook Page, Google Search, Friends, Physical Signage, and Others; require a description when Others is chosen.
- **Existing-customer compatibility** — identify missing category data for admin completion without fabricating past prices, payment history, or lead sources.

### Attendance and Payment Collection

- **Payment when due** — show Cash / GCash only for a chargeable daily session or membership purchase/renewal, rather than every attendance event.
- **Expired-member daily visits** — allow an expired member to select a paid daily session and check in without extending membership; preserve their member profile and history.
- **Daily charge uniqueness** — record one expected daily fee per customer per Philippine calendar day; repeat submissions, same-day returns, checkouts, and visitor approval must not duplicate it.
- **Pending daily GCash attendance** — allow immediate check-in after submitting the receipt while payment remains pending admin review.
- **Cash confirmation** — record customer-selected cash as pending until the admin confirms receipt; direct admin entry may confirm cash in the same reviewed action.
- **Receipt upload** — show image upload when GCash is selected and link the uploaded receipt to its specific charge and payment request.
- **Two reference numbers** — generate a unique Tibay transaction number and separately extract/store the GCash transfer reference from the uploaded receipt.
- **OCR-assisted review** — extract the reference and amount where readable, flag uncertainty and reused references for review, and allow audited admin correction; OCR does not approve payment.
- **New membership purchase records** — extend existing membership creation and guest conversion with a reviewed price, coverage, and financial record.

### Customer Renewal and Admin Payment Review

- **Customer renewal page** — use the saved phone number to access limited renewal options and payment status without an SMS verification code.
- **Restricted customer session** — bind server-side actions to the selected customer and return only the data needed for renewal/status; keep other customers, private profile details, and admin actions inaccessible through this flow.
- **Renewal submission** — select coverage using configured prices, preview the amount and dates, choose Cash / GCash, and submit a request.
- **Renewal Requests tab** — list cash and GCash renewal submissions with customer, category, coverage, amount, submission time, Tibay transaction number, available GCash reference, receipt, and review outcome.
- **Daily payment review** — expose pending daily payments through a payment-review section/filter so immediate attendance can still be followed by admin confirmation.
- **Manual confirmation** — require administrator confirmation for both cash and GCash renewals before extending membership.
- **Payment status visibility** — show pending, approved, or rejected outcomes and an appropriate rejection reason to the customer.
- **Approval consistency** — prevent duplicate approval and duplicate extensions; if membership changed since submission, require the admin to review refreshed coverage before approval.
- **Rejected submissions** — permit a linked replacement submission without duplicating its underlying charge or losing the earlier review history.

### Overview and Statistics

- **Overview collections** — show today's expected collection amount with separate daily-session, renewal, and new-membership amounts.
- **Live attendance preservation** — retain the currently-in-the-gym count and recent check-ins as real-time information alongside collections.
- **Collection meaning** — distinguish expected charges, pending payments, and confirmed money received; an upload or attendance event alone does not confirm a collection.
- **Financial Statistics** — make collections the main Statistics content with daily, weekly, monthly, and selected-date totals, counts, trends, and breakdowns by purchase type.
- **Payment breakdown** — distinguish cash and GCash and pending versus confirmed payments within the reporting period.
- **Reporting dates** — use Philippine calendar days and Monday-start weeks; attribute expected purchases to their charge/purchase date and confirmed collections to their confirmation date.
- **Pending renewal requests** — display their requested amounts separately; do not count a request as an approved membership sale before approval.
- **Attendance continuity** — preserve useful existing attendance oversight while adding financial reporting.

### Administrator Audit

- **Complete change history** — record admin creates, edits, approvals, rejections, and deletions across profiles, membership, attendance corrections, weight entries, RFID administration, rates, payments, receipts, and SMS settings/actions.
- **Reviewable events** — capture actor, action, affected record, timestamp, relevant before/after values, reason where applicable, and operation identifier.
- **Durable deletion record** — retain the audit event when a customer or related record is deleted; do not repeat the current cascading removal of all history for the new audit trail.
- **Private audit access** — provide an admin audit view with date, action, and record/customer filtering; exclude secrets and unnecessary receipt contents from event payloads.
- **Mutation coverage** — move relevant direct browser writes behind audited server actions/services so successful changes cannot bypass the new audit trail.

### SMS — Final Build Stages

- **Provider setup** — add configurable sending settings, templates, credentials handling, and a test-send action; keep sending disabled until a provider is selected and configured.
- **Expiry reminders** — send at 7, 5, and 1 day before current expiry, at most once per member/reminder point/expiry cycle.
- **Renewal-aware eligibility** — recalculate against the latest expiry and send only future eligible reminders, without a backlog of obsolete reminders.
- **Inactivity follow-up** — notify members whose last attendance was more than 10 days ago; suppress repeated daily follow-ups for the same inactivity episode.
- **Admin text blast** — compose a message, choose eligible recipients, preview recipient count, explicitly send, and review per-recipient outcomes.
- **Sending visibility** — keep attempts, provider responses, and delivery receipts only when supplied by the provider; distinguish provider acceptance from delivery.
- **Contact eligibility** — preserve contact permission and opt-out information and exclude ineligible numbers from automated and bulk sends.

## 4. Membership Lifecycle

```text
Existing active member → expired member
Expired member + approved daily payment → remains expired; daily attendance only
Active or expired member + pending renewal → membership unchanged
Active or expired member + approved renewal → active with extended expiry
Guest + approved membership purchase → active member; existing history preserved
```

- Retain existing expiry and renewal-date rules: active memberships extend from current expiry; expired memberships restart from the approved renewal date.
- Calculate final coverage at approval and require review if the prior membership changed; record the applied start/expiry and price snapshot.
- Apply an approved purchase once; repeat clicks, retries, and concurrent admin actions must not extend membership twice.
- Daily-session approval never changes membership expiry or standing.

## 4b. Payment Request Lifecycle

```text
submitted → pending review → approved
                           ↘ rejected → linked replacement submission
```

- Cash submissions enter pending review; GCash submissions include a receipt, while OCR can complete independently.
- A daily request may have a valid visit while pending or rejected; payment review does not erase attendance.
- Approval records actual confirmation time and admin identity. For membership purchases/renewals, charge recognition, approval, and membership extension must complete once as one authoritative operation.
- Rejection requires a review reason and does not extend membership or confirm a collection.
- A rejected attempt remains in history; a replacement links to the same purchase intent or daily charge rather than creating a second charge.

## 4c. Receipt OCR Lifecycle

```text
uploaded → queued → processing → extracted
                              ↘ needs review
                              ↘ failed → retry queued
```

- Store images privately and associate metadata with a payment request before processing.
- Preserve raw extracted text privately, parsed values, confidence where available, and audited corrections; unreadable or unsupported images require human review.
- Detect a reference already associated with another payment and surface the conflict before approval.
- OCR failure leaves payment pending review; it never silently approves or rejects a payment.

## 4d. SMS Message Lifecycle

```text
queued → sending → provider accepted → delivered, if provider confirms
                 ↘ failed → eligible retry
queued → cancelled or skipped
```

- Queue one recipient message per reminder key or campaign recipient; claim work before sending to limit concurrent duplicates.
- Recheck expiry, inactivity, and contact eligibility immediately before sending; cancel obsolete work after renewal or a new visit.
- Retry only where provider behavior permits; reconcile uncertain sends rather than blindly resending after a lost response.
- Provider acceptance alone is not delivery; retain attempts and the provider message identifier.

## 5. Data Model

Conceptual additions only; field types, indexes, and storage contracts are finalized during implementation. Existing models are shown only where an extension or linkage is required.

```text
Firestore: Person (existing, extended)
  existing id, phone, type, status, membershipExpiry, visitCount, lastVisitAt
  + rateCategory: student | regular | unset-for-existing-record
  + profileImagePath?, leadSource?, leadSourceOther?
  + smsPermission?, smsOptOutAt?

Firestore: UnverifiedPerson (existing, extended)
  registration details + category + lead source + optional image path
  approval preserves identity and links to visits, charges, and payment requests

Firestore: GymSettings
  currency: PHP, timeZone: Asia/Manila, weekStartsOn: Monday
  studentDailyMinor: 6000, regularDailyMinor: 7000
  studentMonthlyMinor: unset, regularMonthlyMinor: unset
  rateRevision, updatedBy, updatedAt
  smsEnabled: false initially, providerName?, sender?, sendTime?, templates
  expiryReminderDays: [7, 5, 1], inactivityDays: 10

Firestore: Charge
  id, tibayTransactionNumber, personId (official or pending identity)
  kind: daily_session | new_membership | renewal
  chargeDate, recognizedPurchaseAt? (membership sale only after approval)
  categorySnapshot, rateRevision, unitRateMinor, quantity, amountMinor
  requestedCoverage?, approvedCoverage?, dailyVisitDate?, attendanceLogId?
  uniqueDailyKey? (personId + Philippine date), createdAt

Firestore: PaymentRequest
  id, chargeId, personId, method: cash | gcash
  status: pending | approved | rejected
  amountMinor, receiptId?, submittedAt, previousRequestId?
  reviewedBy?, reviewedAt?, rejectionReason?, confirmedAt?
  appliedMembershipStart?, appliedMembershipExpiry?, operationId
  gcashReferenceSnapshot? (admin-confirmed value)

Firestore: ApprovedGcashReference
  normalizedReference (unique key), paymentRequestId, chargeId, claimedAt

Firestore: CustomerSession
  opaqueSessionHash, personId, createdAt, expiresAt, revokedAt?
  scope: renewal submission and limited payment status

Supabase Postgres: Receipt
  id (primary key), paymentRequestId (unique cross-system link)
  personId, privateObjectPath (unique), uploadedAt
  ocrStatus: queued | processing | extracted | needs_review | failed
  extractedReference?, normalizedReference?, extractedAmountMinor?
  rawText?, confidence?, errorCode?, processedAt?, attemptCount
  correctedReference?, correctedAmountMinor?, correctedBy?, correctedAt?

Supabase Storage: Private images
  receipt objects linked through Receipt
  profile picture objects linked through Person / UnverifiedPerson

Firestore: AuditEvent
  id, actorId, action, entityType, entityId, personId?
  relevantBefore?, relevantAfter?, reason?, occurredAt, operationId
  append-only; deletion of the subject does not delete the event

Firestore: SmsCampaign
  id, createdBy, messageSnapshot, audienceSnapshot, createdAt, dispatchRequestedAt?
  progress totals derived from recipient messages; no separate campaign status

Firestore: SmsMessage
  id, personId, campaignId?, purpose: expiry | inactivity | blast | test
  destination, templateSnapshot, deduplicationKey
  expirySnapshot?, reminderOffset?, lastVisitSnapshot?
  status: queued | sending | accepted | delivered | failed | cancelled | skipped
  scheduledAt, claimedAt?, providerMessageId?, completedAt?

Firestore: SmsAttempt
  id, messageId, attemptNumber, attemptedAt, providerResponseCode?
  providerAccepted?, errorCode?, deliveryReportedAt?
```

**Scalability notes**

- Store money as integer centavos; snapshot pricing and dates rather than recomputing old purchases using current settings.
- Keep approval, membership changes, approved-reference claims, and their audit event in the Firestore transaction boundary. Supabase owns receipt artifacts and extraction metadata, not the authoritative membership decision.
- Use stable request/operation IDs and retryable steps across Firebase and Supabase; their writes do not share a database transaction. Recover interrupted uploads and remove orphaned images through bounded cleanup.
- Enforce one daily charge using a transactionally claimed customer/date key, including pending visitors; approval preserves the association.
- Generate the Tibay number once with a transactionally allocated sequence or another server-enforced unique scheme; never use record count plus one. Its display format remains an open item.
- Enforce GCash reference reuse checks at approval using the authoritative unique reference claim, not only a frontend search or OCR similarity check.
- Add primary/unique keys and lookup indexes for receipt links and normalized references. Enable RLS and private Storage access; privileged server access must separately authorize every operation because the existing Supabase secret bypasses RLS.
- Paginate review/audit screens and query charges and confirmations by reporting date. Add rebuildable summary documents if volume requires them; retain underlying records for traceability.
- Preserve financial and new audit history through ordinary profile deletion using retained minimal identifiers and documented retention. Final deletion/anonymization policy is an open item.
- Phone-only entry is the requested access model and does not prove ownership of the number; limit the returned data and actions, throttle access, and keep approval admin-only.
- Normalize reporting and charge dates to Asia/Manila explicitly; current date utilities mix configured gym dates and device-local boundaries.

## 6. Suggested Build Order

1. **Shared financial rules, settings, and data contracts** — establish categories, configurable rates, Philippine dates, collection definitions, uniqueness, and historical-data handling before money is recorded.
2. **Audit foundation and protected mutations** — capture changes from the first new workflow and cover existing admin mutation paths without rebuilding their interfaces.
3. **Registration additions and customer access** — provide the entry choice, category, lead source, optional photo, and restricted phone-based session needed by later public flows.
4. **Charges and Cash / GCash daily-session flow** — implement one charge per day, expired-member daily eligibility, immediate pending-payment attendance, and cash confirmation on the existing attendance foundation.
5. **Private receipts, Tesseract, and reference handling** — add reviewable evidence, recoverable extraction, unique Tibay numbers, and duplicate GCash reference controls before GCash approval.
6. **Customer purchases/renewals and admin review** — connect submissions, the Renewal Requests tab, daily payment review, customer status, and exactly-once membership activation.
7. **Overview and financial Statistics** — build totals and breakdowns from the completed financial workflow while retaining live attendance.
8. **Non-SMS workflow verification** — verify repeat check-ins, approval races, rejection/resubmission, rate changes, reporting boundaries, existing profiles, deletion retention, and existing attendance/renewal behavior before adding outbound messages.
9. **SMS provider configuration and sending history** — introduce the shared queue, provider adapter, templates, eligibility, test sends, and outcomes in the latter part of the work; activation waits for a provider.
10. **Expiry and inactivity SMS** — add renewal-aware 7/5/1-day reminders and more-than-10-day follow-ups on the shared sending foundation.
11. **Admin text blast and final handover** — add explicit campaign dispatch and recipient outcomes after sending controls are established, then document settings and operating workflows.

Receipt work can move alongside registration once the contracts are fixed; all SMS-related implementation stays in the final stages. Convert this order into a separate phased TASKLIST only when requested.

## 7. Open Items / Future Considerations

- **Pricing:** Monthly amounts remain unset. Confirm whether longer terms multiply the monthly rate or have explicit package prices, and how custom-expiry amounts are calculated; do not invent discounts or proration.
- **Existing records:** Decide how admins classify current customers. Historical attendance does not establish historical payment amounts, so financial reporting starts from an explicit cutover without fabricated backfill.
- **Collection definitions:** The proposed rule counts pending daily charges as expected, pending renewal requests separately, and approved membership purchases as recorded sales; confirm labels at the view-spec stage.
- **Registration approval:** Preserve existing pending-visitor approval unless changed explicitly; determine whether new membership purchase approval also completes profile approval in one admin action.
- **Review policy:** Define how an admin handles a daily payment rejected after attendance, and whether approved transaction corrections/voids are needed. A full correction/voiding workflow is not included by default.
- **Images and OCR:** Choose accepted formats, file-size limits, retention, Tesseract runtime, and handling for unreadable or password-protected attachments; screenshots remain evidence for manual review.
- **Reference format:** Agree the Tibay transaction-number display format; GCash references remain distinct provider identifiers.
- **Audit retention:** Agree retention/anonymization for deleted customers and sensitive before/after fields. Never log passwords, provider secrets, or full session tokens.
- **SMS:** Select provider, sender identity, daily sending time, message text, retry limits, and funding before activation. Define the first inactivity follow-up for members with no recorded visit, repeat cadence, and contact permission/opt-out collection.
- **Delivery:** Existing RFID hardware operation and hosting setup are preserved dependencies, not new features to rebuild. Real hardware and production schedule verification remain handover checks.
- **Outside this extension:** Staff roles, class booking, workout plans, native apps, door control, offline operation, expenses/net profit, bank reconciliation, partial payments, two-way SMS, and online payment processing remain excluded unless separately requested.

Reference: Tibay Gym - Scope Proposal.pdf, October 22, 2026, pages 2–6, plus the confirmed requirements in this conversation.
