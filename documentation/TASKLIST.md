# Tibay Gym — Project Task List

**Purpose:** Single source of truth for new-feature build progress, grouped by phase and following the Suggested Build Order in `new-features-project-plan.md`.

**Companion docs:** [New Features Project Plan](new-features-project-plan.md) — approved scope, rules, lifecycles, data model, build order, and open items. No separate view-content plans exist; the user explicitly approved deriving Build items directly from this plan.

**Scope:** Missing features and extensions only. Preserve existing attendance, RFID, customer records, renewal-date behavior, and weight tracking. All items start unchecked; this document does not claim anything has been implemented.

**Execution:** Implement one requested phase at a time. Read the installed Next.js guides before application changes. Each phase includes its relevant validation; Phase 8 is the non-SMS readiness checkpoint. The selected task list is `documentation/TASKLIST.md`; name this path explicitly when requesting phase execution because the local phase-workflow skill defaults to `Documentation/Plan/TASKLIST.md`.

**SMS boundary:** All SMS-specific fields, settings, permission/opt-out collection, provider integration, queues, templates, schedules, notifications, tests, audit integration, and bulk campaigns belong exclusively to Phases 9–11. Phases 1–8 must work without an SMS provider. Provider selection/setup gates live SMS activation, not completion of the non-SMS system.

**UI approach:** Extend existing interface conventions; no external design handoff is part of this task list.

## Phase 1 — Shared Financial Rules, Settings, and Data Contracts

Establish pricing and collection rules before recording money.

- [x] **Build:** Define non-SMS contracts for charges, payment requests, customer sessions, receipt links, reference claims, and relevant existing-profile extensions; leave SMS models for Phase 9.
- [x] **Build:** Add Student / Regular category independently of Member / Guest; represent unclassified existing customers without fabricating a category.
- [x] **Build:** Add configurable daily/monthly rates in Admin Settings, with PHP 60 Student / PHP 70 Regular daily defaults and monthly prices unset.
- [x] **Build:** Validate configured prices and prevent membership purchase submission when its applicable rate is unset.
- [x] **Build:** Store amounts in integer centavos and define category/rate/coverage snapshots so settings changes never rewrite past purchases.
- [x] **Build:** Standardize charge/reporting dates on Asia/Manila with Monday-start weeks; define purchase-date versus confirmation-date attribution.
- [x] **Build:** Define separate expected charges, pending requests, and confirmed collections, including pending daily charges and separately displayed pending renewals.
- [x] **Build:** Establish daily customer/date uniqueness, stable operation identifiers, and the financial cutover without historical payment backfill.
- [x] **Verify:** Check rate validation, unset monthly rates, date boundaries, snapshot stability, and compatibility with existing profiles.

## Phase 2 — Audit Foundation and Protected Mutations

Capture changes before new operational workflows are added.

- [x] **Build:** Add append-only AuditEvent records with actor, action, subject, timestamp, relevant before/after values, reason where applicable, and operation ID.
- [x] **Build:** Route existing profile, membership, attendance correction, weight, RFID administration, and rate changes through protected audited server operations.
- [x] **Build:** Include creates, edits, approvals, rejections, and deletions; expose an admin audit view with date, action, and record/customer filters and pagination.
- [x] **Build:** Preserve new audit and financial records through ordinary profile deletion, retaining minimal identifiers according to the documented retention decision.
- [x] **Build:** Prevent browser writes from bypassing audit capture and exclude secrets, full session tokens, and unnecessary receipt contents.
- [x] **Build:** Make audit events part of authoritative financial/admin changes where transaction boundaries permit; new workflows add their events in their own phases, with SMS coverage deferred to Phases 9–11.
- [x] **Verify:** Check access controls, concurrent/retried mutations, deletion retention, and continued operation of existing admin actions.

## Phase 3 — Registration Additions and Customer Access

Supply customer details and restricted access needed by later workflows.

- [x] **Build:** Add Create Account / Check In entry choices using existing phone lookup and visitor approval behavior.
- [x] **Build:** Require Student / Regular category on public registration and admin-created profiles; support admin completion of existing missing categories.
- [x] **Build:** Add the required lead-source question with Ads, Facebook Page, Google Search, Friends, Physical Signage, and Others; require details for Others.
- [x] **Build:** Add optional profile photo upload, private image storage, authorized image access, profile display, and failed-upload/orphan cleanup.
- [x] **Build:** Preserve pending-profile identity, category, lead source, and picture through approval without losing visits or later financial links.
- [x] **Build:** Add phone-number customer entry without OTP and a restricted server-issued session for renewal submissions and limited payment status.
- [x] **Build:** Bind customer actions to that session, limit returned information, throttle access, and prevent access to other customer IDs or admin operations.
- [x] **Verify:** Check duplicate registration, pending approval, optional photo failures, required fields, session expiry, and customer-data boundaries.

## Phase 4 — Charges and Daily-Session Payment Flow

Extend attendance without changing membership entitlement for daily visits.

- [x] **Build:** Record one expected daily charge per customer per Philippine date, including pending visitors; preserve the association during approval.
- [x] **Build:** Show Cash / GCash only when payment is due; active covered members retain ordinary attendance without a daily payment prompt.
- [x] **Build:** Allow expired members to choose a chargeable daily session and check in while retaining expired membership and existing history.
- [x] **Build:** Create pending cash requests and allow direct admin cash confirmation through an explicit reviewed action; retain audit evidence.
- [x] **Build:** Define pending GCash request/receipt-link handling and immediate attendance semantics; complete public upload wiring in Phase 5 and admin review in Phase 6.
- [x] **Build:** Keep unfinished GCash submission unavailable until Phase 5 supplies a valid receipt-upload path; do not accept a fake or missing receipt as a completed GCash submission.
- [x] **Build:** Keep visits independent of payment review, so later rejection does not erase attendance or extend membership.
- [x] **Verify:** Check same-day returns, checkout, repeat submissions, concurrent check-ins, lost responses, midnight boundaries, and visitor approval for duplicate charges.

## Phase 5 — Private Receipts, Tesseract, and Reference Handling

Provide reviewable payment evidence before GCash approval.

- [x] **Build:** Add private Supabase receipt storage and metadata with unique request/object links, required indexes, RLS, and server authorization.
- [x] **Build:** Validate supported image formats/sizes and authorize receipt uploads and viewing without exposing privileged credentials or public objects.
- [x] **Build:** Wire conditional GCash receipt upload into the daily flow; allow immediate check-in after submission while payment awaits approval.
- [x] **Build:** Generate one unique Tibay transaction number per charge using a concurrency-safe server mechanism; never derive it from record count.
- [x] **Build:** Integrate Tesseract processing with queued, processing, extracted, needs-review, and failed outcomes and retryable jobs.
- [x] **Build:** Extract reference and amount where readable, retain private extraction evidence, and support audited admin corrections.
- [x] **Build:** Normalize GCash references, flag reuse, and establish the authoritative unique reference claim used during approval.
- [x] **Build:** Recover interrupted Firebase/Supabase operations using stable identifiers, bounded retries, and orphan cleanup; OCR never confirms payment.
- [x] **Verify:** Check unreadable images, amount mismatches, duplicate references, unauthorized access, extraction failures, retries, and cross-system interruption recovery.

## Phase 6 — Customer Purchases, Renewals, and Admin Review

Connect payment decisions to exactly-once membership activation.

- [x] **Build:** Add the customer renewal page with configured pricing, coverage/date preview, Cash / GCash selection, receipt submission, and limited status history.
- [x] **Build:** Extend admin new-membership creation and guest conversion with reviewed price, coverage, and financial records while preserving customer identity/history.
- [x] **Build:** Add the Renewal Requests tab with customer, category, coverage, amount, submission date, Tibay number, GCash reference, receipt, and outcome.
- [x] **Build:** Add daily payment review through a section/filter without mixing daily approval with membership extension.
- [x] **Build:** Require admin confirmation for both cash and GCash renewals; pending or rejected requests never extend membership.
- [x] **Build:** Approve payment, claim the GCash reference where applicable, recognize the purchase, extend membership, and record audit evidence in one authoritative Firestore operation.
- [x] **Build:** Apply each membership purchase once despite double clicks, retries, or concurrent approvals; require refreshed review if membership changed since submission.
- [x] **Build:** Preserve active-from-current-expiry and expired-from-approval-date rules; store final applied coverage.
- [x] **Build:** Require a rejection reason, show pending/approved/rejected status to the customer, and allow linked replacement submissions without duplicate charges.
- [x] **Verify:** Check both methods, reused references, stale membership previews, repeated approvals, rejection/resubmission, and preserved guest history.

## Phase 7 — Overview and Financial Statistics

Report from completed financial workflows while retaining live attendance.

- [x] **Build:** Show today's expected collection amount on Overview, split into daily sessions, renewals, and new memberships.
- [x] **Build:** Keep currently-in-the-gym counts and recent check-ins real-time alongside the new figures.
- [x] **Build:** Clearly distinguish expected charges, pending payments, confirmed collections, and separately displayed pending renewal requests.
- [x] **Build:** Make finance the main Statistics content with daily, weekly, monthly, and selected-date totals and transaction counts.
- [x] **Build:** Add collection trends and purchase-type breakdowns, plus Cash / GCash and pending / confirmed distinctions.
- [x] **Build:** Apply Philippine reporting dates, Monday-start weeks, purchase-date attribution, and confirmation-date attribution consistently.
- [x] **Build:** Preserve useful existing attendance oversight; paginate/query underlying financial records and introduce rebuildable summaries only if required by volume.
- [x] **Verify:** Reconcile figures with source records across rate changes, pending/rejected submissions, delayed confirmations, and date boundaries.

## Phase 8 — Non-SMS Workflow Verification and Readiness

Independent engineering and local/live-backend receipt verification are finished. Deployment/hardware and full authenticated phone/browser walkthroughs remain unchecked; hosting/schedules are deferred by the owner. See OWNER-FOLLOWUPS.md and receipt-gcash-live-verification.md.

- [x] **Verify:** Exercise registration through attendance, receipt submission, review, membership activation, customer status, and reporting with realistic Student / Regular records.
- [x] **Verify:** Cover concurrency, retries, duplicate daily charges, duplicate references, interrupted uploads, rejected/resubmitted payments, and exactly-once extensions.
- [x] **Verify:** Check existing records, deletion retention, audit completeness, preserved membership/weight flows, and existing QR/RFID behavior.
- [ ] **Verify:** Check mobile usability, validation, loading/error recovery, empty states, and authorized access on all changed views.
- [x] **Verify:** Review private image/receipt access, minimal customer disclosure, privileged credentials, and documented data-retention choices.
- [x] **Verify:** Run appropriate automated tests, lint, and production build; resolve failures introduced by the extension.
- [ ] **Verify:** Check deployed configuration and OCR job recovery where a deployment environment is available; record real RFID hardware verification separately if hardware is unavailable.
- [x] **Document:** Prepare non-SMS operating notes for rates, payment review, reporting, audit history, and financial cutover.
- [x] **Verify:** Confirm Phases 1–8 run without SMS configuration and contain no dependency on SMS setup or sending.

## Phase 9 — SMS Provider Configuration and Sending History

Local implementation complete. Owner selected Android SMS Gateway, approved local defaults, and explicitly deferred device/credential setup and real delivery testing on October 28. Resolve/verification items remain unchecked for activation; this deferral permits local Phases 10–11.

- [ ] **Resolve:** Select the provider, sender identity, funding, daily sending time, template text, retry limits, and contact permission/opt-out approach before live activation.
- [x] **Build:** Add SMS settings and credentials handling, initially disabled; add SMS-specific customer permission/opt-out fields and the agreed collection interface.
- [x] **Build:** Add SmsCampaign, SmsMessage, and SmsAttempt contracts/storage, recipient eligibility, message snapshots, and deduplication keys.
- [x] **Build:** Add the provider adapter, retryable sending queue, worker claims, per-attempt responses, provider IDs, and uncertain-send reconciliation.
- [x] **Build:** Show sending history, failures, provider acceptance, and delivery only when supported by provider evidence.
- [x] **Build:** Add an explicit admin test-send action, private provider configuration access, and audit coverage for SMS settings/actions.
- [ ] **Verify:** Check disabled/unconfigured behavior, eligibility exclusion, duplicate worker claims, failed requests, ambiguous responses, and provider test delivery when configured.
- [x] **Gate:** Keep live SMS disabled until the agreed provider account and required setup are ready; leave provider-dependent checks unfinished rather than reporting simulated sends as live success.

## Phase 10 — Expiry and Inactivity SMS

Local reminder implementation complete using the published shared foundation. Owner explicitly deferred gateway/device and unattended-schedule checks; live sending stays gated.

- [x] **Build:** Schedule expiry reminders at 7, 5, and 1 day before current expiry, once per member/reminder point/expiry cycle.
- [x] **Build:** Recheck the latest expiry immediately before sending; cancel obsolete queued work after renewal and do not batch missed reminder points.
- [x] **Build:** Detect members inactive for more than 10 days using last attendance and the agreed handling for members with no visits.
- [x] **Build:** Deduplicate inactivity episodes and apply the agreed repeat cadence; cancel obsolete follow-ups after a new visit.
- [x] **Build:** Apply contact eligibility, permission, opt-out rules, configured sending time, and audit coverage to automatic messages.
- [x] **Verify:** Check 7/5/1-day boundaries, late registration, renewal before sending, exactly 10 versus more than 10 inactive days, a returning member, and repeated scheduled runs.
- [ ] **Verify:** Validate scheduled operation and real provider responses when configured; preserve the Phase 9 activation gate.

## Phase 11 — Admin Text Blast and Final Handover

Local campaigns and handover complete after published shared queue/reminder verification. Combined verification checkboxes retain deferred live-provider/production portions; no real SMS or blast was sent.

- [x] **Build:** Add admin message composition, eligible-recipient selection, audience snapshot, recipient-count preview, and explicit campaign dispatch.
- [x] **Build:** Queue one deduplicated message per eligible recipient and show per-recipient outcomes and derived campaign progress.
- [x] **Build:** Exclude opted-out/ineligible numbers, preserve message snapshots, and audit campaign creation and dispatch.
- [ ] **Verify:** Check duplicate dispatch, mixed recipient outcomes, retries, opt-outs, authorization, and configured-provider behavior without unintended test blasts.
- [ ] **Verify:** Run final relevant tests, lint, and production build; verify production schedules, provider secrets, sending history, and failure visibility when configured.
- [x] **Document:** Complete handover notes and an admin walkthrough covering collections, payment approval, OCR review, customer access, audit, rates, and SMS operations.
- [x] **Document:** Record deployment/hardware verification results and any unresolved provider-dependent checks; do not mark live SMS complete while setup is pending.

## Open Items

- [ ] **Pricing:** One-month Student PHP 600 / Regular PHP 700 is configured as approved on October 28, 2026. Longer-term/package/custom-expiry pricing remains undecided and unavailable; do not invent discounts or proration.
- [x] **Existing records:** Live inspection on October 28 found zero official or pending profiles, so there are no existing customers to classify. New registrations require Student / Regular. Financial recording starts from the explicit saved cutover without fabricated backfill.
- [x] **Collection definitions:** Owner approved October 28: expected daily charges plus approved membership purchases; pending requests awaiting review with renewals separately displayed; confirmed collections by confirmation date.
- [x] **Registration approval:** Owner approved October 28: retain separate admin profile verification and payment approval; payment approval activates applicable membership and does not replace profile verification.
- [ ] **Review policy:** Define how an admin handles a daily payment rejected after attendance, and whether approved transaction corrections/voids are needed. A full correction/voiding workflow is not included by default.
- [x] **Images and OCR:** JPG/PNG/WebP up to 5 MB, private WebP storage, bundled English Tesseract/Node runtime, unreadable evidence for manual review, non-image/password-protected attachments rejected. Owner approved photo/receipt retention October 28; holds, filing-based accounting protection and local cleanup implemented. Hosted runtime remains a separate deferred check.
- [x] **Reference format:** Owner approved October 28: TB- plus 12-digit transaction-number display (for example TB-000000000001), distinct from the GCash provider reference.
- [x] **Audit retention:** Owner approved minimal internal financial/audit records after deletion, excluding profile/contact/photo/demographic values, and October 28 photo/receipt durations and holds. No new time-based ledger/audit purge. Never log passwords, provider secrets, or full session tokens. See audit-and-retention.md.
- [ ] **SMS:** Android SMS Gateway and local defaults approved October 28: 09:00 Asia/Manila, editable templates, at most three rate-limit-rejection attempts, admin-recorded consent/opt-out, one inactivity message per visit episode and no messages for members without visits. Sender SIM/funding, gateway/device credentials and actual delivery verification remain deferred before activation.
- [ ] **Delivery:** Existing RFID hardware operation and hosting setup are preserved dependencies, not new features to rebuild. Real hardware and production schedule verification remain handover checks.
- [ ] **Outside this extension:** Staff roles, class booking, workout plans, native apps, door control, offline operation, expenses/net profit, bank reconciliation, partial payments, two-way SMS, and online payment processing remain excluded unless separately requested.

## Progress Log

| Date | Phase | Note |
|---|---|---|


| 2026-10-25 | 1 | Financial contracts, pricing settings, snapshots, reporting dates and cutover; automated checks passed. Published as 4f1e2fd on origin/main. |

| 2026-10-25 | 2 | Protected audited mutations, filtered audit view, minimal deletion retention; tests/lint/build passed. Published as b897cef on origin/main. |

| 2026-10-25 | 3 | Required registration details, restricted customer sessions/status, private photos and recovery; verified private bucket. Published as bd72bc8 on origin/main. |

| 2026-10-25 | 4 | Atomic daily charges and pending cash, explicit reviewed collection, preserved attendance/expiry and GCash gate; tests/lint/build passed. Published as fbbc759 on origin/main. |

| 2026-10-25 | 5 | Receipt/OCR implementation and local verification built; live SQL activation and live access checks pending. Continuing independent work per owner instruction. Published as f817bc3 on origin/main. |

| 2026-10-25 | 6 | Customer/admin purchase requests, reviewed exactly-once cash/GCash decisions, replacement links and membership coverage; 364 local tests pass. Live GCash verification pending. Published as 21998c8 on origin/main. |

| 2026-10-26 | 7 | Snapshot-based financial Overview and Statistics, bounded consistent queries, paginated ledger and reconciliation/UI checks. Published as 0b57998 on origin/main. |

| 2026-10-26 | 8 | Independent non-SMS integration/readiness work complete; 384 tests, lint, types, production build and HTTP checks passed. Live receipt/deployment/hardware/full device walkthroughs remain pending. Published as edf7b4d on origin/main. |
| 2026-10-28 | 5 | Owner applied receipt SQL manually; npm run receipts:setup passed against the live project. Database activation complete; live upload/OCR/GCash verification remains pending. |
| 2026-10-28 | 8 | Prepared protected POST scheduling for receipt/OCR and photo cleanup; 394 tests passed. Owner deferred hosting/paid resources and live schedules to focus on local functionality. |
| 2026-10-28 | 1 | Saved and audited monthly Student PHP 600 / Regular PHP 700, daily PHP 60 / PHP 70, revision 1 and explicit cutover. Zero existing profiles to classify; 20 finance tests passed. |
| 2026-10-28 | 5–6, 8 | Live-backend synthetic receipt/GCash verification passed; report indexes deployed, all disposable fixtures removed and totals zero. Phases 5–6 verified; full phone UI/hardware and deferred hosting remain. |
| 2026-10-28 | 8 | Owner approved current transaction format, financial labels/date attribution and separate profile/payment approvals; physical RFID testing explicitly deferred. |
| 2026-10-28 | 8 | Implemented approved photo/receipt retention, admin dispute/legal holds, confirmed filing-based accounting expiry, resumable cleanup and customer notices. 420 tests, lint, types and final build passed; published as 33503ea and verified on origin/main. |
| 2026-10-28 | 9 | Android SMS Gateway adapter, disabled settings, consent, test queue, claims/reconciliation, history and private deletion implemented; owner deferred gateway setup/live delivery and authorized remaining local phases. Publication pending. |
| 2026-10-28 | 10 | Added Philippine-time expiry/inactivity scans, local preview, deduplication and latest-state cancellation; live schedules/provider checks deferred by owner. Phase 9 published as 05b105d on origin/main. |
| 2026-10-28 | 11 | Built explicit reviewed campaign dispatch, immutable audiences and derived per-recipient progress; completed cross-feature operating handover. Gateway/production/hardware checks remain deferred. Phase 10 published as 5681bca. |
| 2026-10-28 | 9–11 | Local SMS implementation published and ancestry verified on origin/main: Phase 9 05b105d; Phase 10 5681bca; Phase 11 4276853. Final checks: 471 tests, lint, TypeScript and production build passed. Real sending, gateway setup, hosting/schedules, RFID and full production phone checks remain deferred. |
