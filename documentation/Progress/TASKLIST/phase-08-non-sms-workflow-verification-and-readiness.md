# Phase 08 — Non-SMS Workflow Verification and Readiness

**Status:** partial — independent engineering and local/live-backend receipt verification complete; full phone/browser and deferred hosting/hardware checks pending
**Task list:** documentation/TASKLIST.md
**Task list items covered:**

- [x] **Verify:** Exercise registration through attendance, receipt submission, review, membership activation, customer status, and reporting with realistic Student / Regular records.
- [x] **Verify:** Cover concurrency, retries, duplicate daily charges, duplicate references, interrupted uploads, rejected/resubmitted payments, and exactly-once extensions.
- [x] **Verify:** Check existing records, deletion retention, audit completeness, preserved membership/weight flows, and existing QR/RFID behavior.
- [ ] **Verify:** Check mobile usability, validation, loading/error recovery, empty states, and authorized access on all changed views.
- [x] **Verify:** Review private image/receipt access, minimal customer disclosure, privileged credentials, and documented data-retention choices.
- [x] **Verify:** Run appropriate automated tests, lint, and production build; resolve failures introduced by the extension.
- [ ] **Verify:** Check deployed configuration and OCR job recovery where a deployment environment is available; record real RFID hardware verification separately if hardware is unavailable.
- [x] **Document:** Prepare non-SMS operating notes for rates, payment review, reporting, audit history, and financial cutover.
- [x] **Verify:** Confirm Phases 1–8 run without SMS configuration and contain no dependency on SMS setup or sending.

---

## Log

### 2026-10-26
- Exercised combined synthetic Student/cash and Regular/GCash workflows through registration, visitor approval, session access, daily rejection, purchase linking/review, concurrent activation, status, covered attendance, weight preservation, reporting and deletion retention. Receipt upload itself is a separately tested boundary; live Supabase verification remains unfinished.
- Corrected server session sign-out/account switching and displayed expiry; exposed limited status to pending visitors while withholding purchases. Added session and client retry/expiry tests.
- Corrected daily review's inferred method: replacement cash IDs no longer appear as GCash; rejected requests are labelled for replacement rather than impossible direct confirmation. Approval still requires changed-coverage acknowledgment; rejection no longer asks the admin to accept entitlement that will not be applied.
- Improved visible controls, readable phone forms, keyboard-accessible table scrolling, compact Overview figures, request loading/empty/error states and stale request protection. Inspected synthetic finance/customer/payment views at 390×844 and 1280×900; checked final production public entry/customer pages at mobile width. Full authenticated real-device walkthrough remains pending.
- Executed npm test: 62 files / 384 tests passed. npm run lint and npx tsc --noEmit passed. npm run build passed, including server-runtime precheck. An initial test-only ByRoleOptions type error was corrected before successful final checks.
- Executed bounded HTTP abuse check on fresh loopback production server: 110 requests, 23 validation rejections, 85 throttles, p95 25 ms; no write-capable valid bodies were sent. Eleven private GET endpoints returned 401 with no-store. Scanned 40 browser JS/map files against three configured private values: no leaks. No values logged.
- Reviewed private artifacts, approved minimal retention, credentials and SMS independence. Wrote NON-SMS-OPERATIONS.md and phase-8-verification.md; updated OWNER-FOLLOWUPS.md. No SMS implementation, live financial test data, invented prices or production deployment was introduced.
- External receipt SQL/access, hosting/runtime/schedules, hardware and full authenticated deployed-phone checks remain unchecked per the owner's explicit instruction to proceed independently. GCash remains gated by failed live readiness. See the verification matrix and follow-ups for limits, rather than interpreting local success as live activation.
- Files: customer session/access, purchase decision guard, daily/payment review, shared financial controls and compact Overview, cross-workflow/session/client tests, operating/verification/progress/checkpoint documentation.

**Suggested commit message:** `fix(phase-08): verify non-SMS workflows and close readiness gaps`

**Publication:** edf7b4d4c64881f3743e00e035c071ea86610f80 verified on origin/main after push. Local/remote hashes matched and phase-branch ancestry passed. Final tracking is published separately.

### 2026-10-28 — hosting and scheduled-job preparation
- Owner confirmed no hosting provider/account or live URL has been selected. No linked project, canonical app URL or CRON_SECRET is configured; no cloud resources, bills or schedules were created.
- Added shared maintenance authorization to both receipt recovery/OCR and photo cleanup POST routes. Exact private scheduled credentials or the existing verified admin flow are required before work. Byte-length comparison handles malformed non-ASCII headers without timingSafeEqual length errors. Both routes declare a 120-second deployment budget.
- Added ten authorization/route tests covering missing/wrong/short/non-ASCII credentials, admin fallback, no unauthorized work and uncached results. npm test passed: 63 files / 394 tests; lint and TypeScript passed. Production build passed, including the final route-duration declaration.
- Documented Node/OCR/upload requirements, the two endpoints, proposed cadence, secret handling and live rollout evidence in hosting-and-jobs.md. Read current provider documentation: Vercel's 4.5 MB payload cap conflicts with the existing 5 MB image contract, and its built-in scheduler calls GET rather than these POST endpoints. Firebase App Hosting requires a billing-enabled Blaze project. The owner subsequently requested no paid hosting for now and explicitly deferred deployment to focus on functional local features.
- Hosting/scheduler checklist items remain unchecked. A deployed app, credentials, live OCR/runtime check, matching rules/index rollout and successful scheduled invocations are still needed.

**Suggested commit message:** `fix(phase-08): prepare protected scheduled maintenance endpoints`

### 2026-10-28 — live receipt/GCash readiness checks
- Completed the remaining registration-to-reporting backend check against actual Firebase/Supabase: public pending registration, daily attendance/receipt, verified Student/Regular membership requests, private access, real OCR, reviewed decisions, restricted customer status and reporting. Full phone/browser walkthrough is still unchecked.
- Resolved the missing report-query indexes with firebase deploy --only firestore:indexes --project tibay-gym --non-interactive; waited for building and verified queries. No rules or hosting deployment was performed.
- Verified controlled per-fixture upload/link/correction failures, OCR needs-review/failure outcomes, three-attempt retry exhaustion, expired leases, concurrent claims/approval, duplicate references, replacement idempotency and orphan cleanup. All synthetic objects/text/profiles/payments were removed and source totals returned to zero; pricing/audit retained. See receipt-gcash-live-verification.md.
- Hosting, paid resources and unattended schedules remain deferred. Hardware, full authenticated phone UI, optional package pricing and retention-duration decisions remain open. No application code or migrations changed; latest code checks remain 394 tests plus lint/types/build from the maintenance update.

**Suggested commit message:** `docs(phase-08): record live receipt verification and index readiness`

### 2026-10-28 — owner display/policy approval
- Owner explicitly accepted all five current choices: TB- plus 12-digit transaction numbers distinct from GCash references; expected daily charges plus approved membership purchases; pending requests awaiting review with renewals shown separately; confirmed collections by confirmation date; and separate profile verification versus payment approval/membership activation.
- Marked display/policy review and the related task-list open items complete. Physical RFID testing is explicitly deferred at the owner's request. No application behavior, labels, financial data or retention rules changed.
- Updated the purchase guide to record this decision and reflect already-completed live receipt verification. Documentation-only change; no test/build rerun needed.

**Suggested commit message:** `docs(phase-08): record owner-approved display and payment policies`

### 2026-10-28 — approved photo and receipt evidence retention
- Owner approved the proposed durations and requested implementation. Current profile photos remain while profiles exist; replaced photos and deleted-profile photos become eligible on cleanup. Unfinished uploads keep their 24-hour recovery window.
- Added the 180-day rule from final rejection for rejected/replaced receipt image/raw OCR evidence. Pending/unknown payment reviews, independent dispute/legal holds and approved evidence without confirmed accounting dates stay protected, including after profile deletion. This replaces the old blanket deleted-profile receipt purge.
- Added authenticated, revision-checked and idempotent retention API/admin controls, including payment rows for deleted customers. Confirmed applicable return deadline/actual filing date determines the five-calendar-year accounting expiry; leap dates roll forward. Dates must not precede the payment review and actual filing cannot be in the future. No accounting dates were invented or saved against live records.
- Receipt cleanup rotates through 25 durable intents per run without a new index. Firestore transactions serialize holds against removal claims; once removal starts, date/hold edits are refused. Metadata/raw OCR and the OCR lease are fenced before object removal, interruptions remain resumable, and completion is audited once. Minimal financial/reference/audit records remain. Private image/text access closes when removal starts; old upload retries cannot recreate evidence or bypass deleted-profile checks.
- Added Payment review's Run retention cleanup action for local receipt maintenance (including one OCR job) and photo cleanup, plus customer upload notices and operating guidance. New private Firestore collections use existing default-deny rules; no SQL migration, cloud resource or scheduled job was added.
- Verification: npm test passed **67 files / 420 tests**. npm run lint, npx tsc --noEmit and production build passed. After tightening UI synchronization with the latest saved hold revision, both targeted DOM tests, lint and the final production build (including TypeScript) passed again. Coverage includes time boundaries, on-time/late/leap filing dates, holds/releases, stale/retried operations, interrupted storage cleanup, scan pagination, authorization, deleted profiles, photo replacement and evidence resurrection prevention. No live evidence purge or full phone/browser walkthrough is claimed by these tests.
- Updated documentation/TASKLIST.md, OWNER-FOLLOWUPS.md and retention/recovery guides. Retention decision/implementation is complete; approved-receipt accounting-date confirmation is a future operational follow-up. Full phone/hardware and deferred hosting/schedule checks remain unchecked. Published implementation as **33503ea19a7887b95a21ddeeeab61824cff74d21** (`feat(phase-08): enforce approved photo and receipt retention`); fetched origin/main matched that commit and the working tree was clean. This documentation-only follow-up records verified publication.

**Suggested commit message:** `feat(phase-08): enforce approved photo and receipt retention`
