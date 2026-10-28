# Phase 8 verification evidence

Date: October 26, 2026, Asia/Taipei. Tests use synthetic records and test-only stores. No real customer financial records were created or approved.

**Update — October 28, 2026:** receipt SQL readiness and the subsequent local application's checks against live Firebase/Supabase passed. Private uploads/access, OCR, public registration, reviewed daily/monthly payments, duplicate references, failures, concurrent recovery and teardown are detailed in receipt-gcash-live-verification.md. The matrix below records the earlier session; its live receipt-backend blockers are resolved. Full phone/browser, hosted runtime and hardware checks remain open; hosting/schedules are deferred by the owner.

| Area | Executed evidence | Remaining limit |
|---|---|---|
| Combined Student / Regular workflow | tests/non-sms-workflow.integration.test.ts runs real registration/attendance, profile approval, session binding, reviewed rejection, cash or GCash purchase proof linking, reviewed correction, concurrent activation, limited customer status, covered visits, reporting, weight preservation and deletion retention against the shared test adapter | Receipt upload boundary is represented by a seeded ready intent; actual live storage/upload/approval remains pending |
| Retries and concurrency | attendance, daily-charges, purchases, private-images, receipt-store, gcash-references, receipt-review and integration suites cover duplicate daily events, operations, references, stale coverage, replacements and interrupted cross-system steps | In-memory transactions serialize contenders; deployment concurrency/latency and physical device checks are not inferred |
| OCR and SQL | Real local Tesseract extraction from a synthetic image; receipt schema tests execute local PostgreSQL-compatible RLS/privileges, uniqueness and SKIP LOCKED lease recovery; worker tests reject lost leases and preserve corrected reviews | Live Supabase migration/readiness and hosted workers are unavailable |
| Existing behavior | Attendance/unverified/RFID firmware/enrollment/security, membership dates, audited mutations, weight and deletion suites remain passing | Physical scanner, real USB provisioning and deployed rules rollout require owner access |
| Customer access | New tests verify server-side sign-out/retries/account switching/cross-origin rejection, session expiry, limited pending-visitor status and verified-only purchase UI | Phone-only access intentionally has no OTP; owner must review the restricted information on the real deployment |
| Finance | Source reconciliation and query pagination tests cover immutable snapshots, delayed confirmations, rejection, all-date pending renewals, boundary dates, missing/conflicting records and explicit volume limits | No live financial backfill; large queues require measured summaries if limits are reached |
| Interface | Browser previews at 390×844 and 1280×900 inspected finance, customer login/purchase/status, and payment review with synthetic data; page width stayed within viewport and wide tables scroll inside their regions. Public check-in entry inspected in production preview. DOM tests exercise loading/error recovery, labels, GCash-disabled state, pending status, stable operations and changed-source page rejection | Full authenticated walkthrough of every changed view on the real deployment and actual phone remains unchecked; previews do not prove live access |
| Access and secrets | Protected route tests; production HTTP unauthenticated probes; image/receipt authorization tests; server-only imports and rules reviewed. Forty browser JS/map files scanned against three configured private values, with no matches | Live storage/RLS access checks await schema activation; no private values were logged |
| Abuse | Bounded production HTTP invalid-body check on loopback: 110 requests, 23 validation rejections, 85 throttles, p95 25 ms; pages respond before/after flood and rotated forwarding headers do not bypass limits | Single process application throttling, not distributed DDoS resistance; bodies fail before database work |
| SMS independence | Search of app/components/lib/package.json/.env.example found only the non-SMS contract comment; no SMS provider, field, queue, required credential or sending dependency | Phases 9–11 intentionally remain unimplemented |

## Readiness corrections

- Sign-out now revokes the stored session instead of merely hiding the screen; account switching revokes the former token and expiry clears the displayed account.
- Pending visitors can inspect their limited payment queue while purchase submission remains withheld until profile verification.
- Daily review uses linked payment method/status. Cash replacements no longer appear as GCash because their request IDs use a different format, and rejected original requests do not offer an impossible direct confirmation.
- Reviewed rejection is allowed after membership changes without agreeing to new entitlement. Approval still requires refreshed coverage acknowledgment.
- Finance/payment/customer controls have visible borders, 44-pixel minimum controls, readable form text and keyboard-accessible horizontal table regions. Overview's compact finance area avoids seven single-column figures on a phone.
- Payment review suppresses false empty states during loading, clears old errors on successful retry, prevents mixed-kind stale list responses, and locks selection while loading a request.

Required checks and publication evidence are finalized in documentation/Progress/TASKLIST/phase-08-non-sms-workflow-verification-and-readiness.md. See OWNER-FOLLOWUPS.md for the actionable remaining checklist.
