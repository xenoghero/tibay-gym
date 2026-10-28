# Phase-run checkpoint — independent work through phase 8 finished

**Saved:** October 26, 2026, Asia/Taipei.
**Activation update — October 28, 2026:** owner applied the receipt SQL migration manually; `npm run receipts:setup` passed against the live project. Database activation is complete. Remaining receipt/GCash end-to-end and deployed-environment checks are still pending; the readiness failure recorded in the original checkpoint is historical.
**Pricing update — October 28, 2026:** saved owner-approved Student PHP 600 / Regular PHP 700 monthly and unchanged PHP 60 / PHP 70 daily prices through the audited settings service, verified at revision 1. Cutover is 2026-10-28T03:17:17.948Z. There are zero official/pending customer profiles to classify. No purchases or historical charges were created. Hosting and unattended jobs remain deferred by the owner.
**Receipt verification update — October 28, 2026:** local route/service tests against live Firebase and Supabase passed for synthetic public/daily/monthly GCash flows, real OCR, private access, duplicate/mismatch/rejection checks, concurrent approvals/leases and interrupted upload/link/correction recovery. Missing-file OCR stopped after three failures. Saved Firestore indexes were deployed (rules were not). All disposable fixtures/artifacts were removed; profiles/payments/receipt metadata and report totals are zero, with original pricing/audit preserved. See receipt-gcash-live-verification.md. No real money transfer or hosted runtime is claimed.
**Usage:** the five-hour reset at Unix 1792946766 was confirmed before resuming. Last observed usage at October 26, 2026, 01:19:50 Asia/Taipei was 33% of the five-hour window and 24% of the weekly window, leaving well over the requested 10% reserve. No credits or reset credits were used.

## Publication

**October 28 retention follow-up:** published and verified **33503ea19a7887b95a21ddeeeab61824cff74d21** on origin/main. All 420 tests (67 files), lint, types and final production build passed; final hold-state UI synchronization also passed its two targeted DOM tests. No live evidence purge/accounting dates or hosted schedules were executed. Last usage observed during this update was 68% of the five-hour window and 11% of the weekly window; the requested 10% reserve is preserved, with no credits/reset credits used.

| Phase | Commit | State |
|---|---|---|
| 1 | 4f1e2fd16ef39d06d2d5eb3ef588aaf88790313b | Complete on origin/main |
| 2 | b897cef21414a62a5d200cb1480784decb24bf66 | Complete on origin/main |
| 3 | bd72bc8029e73c3bef4999febe536b36df096655 | Complete on origin/main |
| 4 | fbbc75943c74a80aef840152bfe978549765232c | Complete on origin/main |
| 5 | f817bc30c39789419478b0651b1a5752eaf47956 | Complete with October 28 live-backend receipt verification |
| 6 | 21998c87fd28da9f222e12e08475ef90b032b750 | Complete with existing automated coverage and October 28 live-backend GCash verification |
| 7 | 0b57998a16349c2c8e6b4171bd6f820cac2eb59a | Complete; ancestry and remote main verified |
| 8 | edf7b4d4c64881f3743e00e035c071ea86610f80 | Independent engineering/local verification finished; owner-dependent live/device checks remain partial |

Initial Phase 8 checks: **62 test files / 384 tests passed**, lint, TypeScript and production build passed. The October 28 maintenance update subsequently passed **63 files / 394 tests**, lint, types and build. Eleven unauthenticated private API probes returned 401/no-store. A bounded 110-request invalid-body HTTP check passed. Forty client JS/map files had no configured private credential values. Synthetic mobile/desktop browser previews passed for finance, customer and payment review. October 28 receipt verification used disposable synthetic financial fixtures against live backends, then removed them; no real customer payments were created or approved.

## Remaining work requires owner access or decisions

Read documentation/OWNER-FOLLOWUPS.md, documentation/receipt-gcash-live-verification.md and documentation/NON-SMS-OPERATIONS.md. Hosting/rules rollout, worker schedules/hosted runtime, the complete authenticated real-phone walkthrough and physical RFID checks remain unfinished. Optional package/custom-expiry prices remain with the owner; one-month prices are configured and no existing classifications are outstanding. Retention durations are approved and implemented; approved-receipt accounting dates still need bookkeeper confirmation before expiry is enabled. Receipt readiness and live-backend GCash checks pass; verify any future deployed environment separately.

The owner explicitly authorized leaving these items unchecked and completing independent later work. Phases 9–11 were not started. Minimal financial/audit retention is approved; names, phones, addresses, photos and birth dates are excluded from retained financial/audit values. On October 28 the owner approved separate photo/receipt durations: current profile photos while profiles exist, orphan uploads 24 hours, rejected/replaced evidence 180 days from rejection, approved evidence protected until a confirmed filing-based accounting expiry, with pending/dispute/legal holds. Implementation and local maintenance controls are recorded in audit-and-retention.md and the Phase 8 log. Relevant approved-receipt filing dates still require bookkeeper confirmation before expiry is enabled. No new implementation is waiting for another usage reset.

Phase 8 publication and origin/main ancestry are verified. This final tracking update records the result; disable the continuation automation after publishing it, as requested. Do not claim full live readiness from local tests. Resume owner-dependent work when the needed access, decisions or confirmed manual results arrive.
