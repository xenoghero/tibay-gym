# Phase 05 — Private Receipts, Tesseract, and Reference Handling

**Status:** complete — local application verified against live receipt/storage backends; hosted runtime/phone walkthrough remains a Phase 8 follow-up
**Task list:** documentation/TASKLIST.md
**Publication:** implementation verified on origin/main at f817bc30c39789419478b0651b1a5752eaf47956; activation follow-up recorded below

**Task list items covered:**

- [x] **Build:** Add private Supabase receipt storage and metadata with unique request/object links, required indexes, RLS, and server authorization.
- [x] **Build:** Validate supported image formats/sizes and authorize receipt uploads and viewing without exposing privileged credentials or public objects.
- [x] **Build:** Wire conditional GCash receipt upload into the daily flow; allow immediate check-in after submission while payment awaits approval.
- [x] **Build:** Generate one unique Tibay transaction number per charge using a concurrency-safe server mechanism; never derive it from record count.
- [x] **Build:** Integrate Tesseract processing with queued, processing, extracted, needs-review, and failed outcomes and retryable jobs.
- [x] **Build:** Extract reference and amount where readable, retain private extraction evidence, and support audited admin corrections.
- [x] **Build:** Normalize GCash references, flag reuse, and establish the authoritative unique reference claim used during approval.
- [x] **Build:** Recover interrupted Firebase/Supabase operations using stable identifiers, bounded retries, and orphan cleanup; OCR never confirms payment.
- [x] **Verify:** Check unreadable images, amount mismatches, duplicate references, unauthorized access, extraction failures, retries, and cross-system interruption recovery.

## Log

### 2026-10-25
- Implemented private receipt metadata migration with unique links, indexes, forced RLS, minimal grants and leased SKIP LOCKED OCR claims. Created/verified the private payment-receipts bucket.
- Implemented conditional GCash uploads, signed/hash-bound receipt intents, immutable object paths, cross-system reconciliation, correction/retry outboxes, bounded orphan/deleted-artifact cleanup and protected private viewing.
- Implemented server-allocated Tibay numbers, conservative extraction/reference normalization, unique reference claim foundation, private admin receipt/OCR review and audited corrections. OCR never changes payments/membership.
- Added bundled English Tesseract runtime with a 45-second extraction budget; real local OCR passed on synthetic evidence. Added local PostgreSQL-compatible migration/RLS/uniqueness/lease tests and upload/proof/retry/claim tests.
- Added deleted-ID tombstones to prevent an old public registration event from reattaching a new identity to retained financial history. Deleted customer receipt image/text access is revoked immediately and artifacts are queued for bounded purge.
- Executed node scripts/receipts-setup.mjs: private bucket succeeded, schema readiness failed because the live migration is not installed. No SUPABASE_DB_URL or management connection is configured. Smallest owner step: run supabase/migrations/202610250001_private_receipts.sql in the project SQL Editor, then npm run receipts:setup; alternatively configure the private database connection and run npm run receipts:setup -- --apply.
- GCash remains unavailable while the readiness gate fails. Live SQL security/upload/recovery verification and production job scheduling remain unchecked. These are retained in documentation/OWNER-FOLLOWUPS.md.
- Owner explicitly authorized leaving input/access-dependent items unfinished and proceeding with independent later phases; cash purchases/review/reporting can continue without live receipt activation.
- Verification: npm test passed (51 files, 353 tests); npm run lint, npx tsc --noEmit and npm run build passed. See documentation/receipts-and-ocr.md for runtime, recovery, provisional transaction-number display and retention details. Live setup readiness failed as recorded above.

**Suggested commit message:** `feat(phase-05): add private receipt evidence and recoverable OCR review`

### 2026-10-28
- Owner confirmed applying supabase/migrations/202610250001_private_receipts.sql manually in Supabase SQL Editor.
- Executed `npm run receipts:setup` against the configured live project; exit 0: "Private receipt bucket, schema and access gate verified."
- Checked off database activation. The earlier missing-schema blocker is resolved; GCash availability follows the existing server readiness check without a code/configuration bypass.
- Kept live receipt upload/view authorization, OCR lease/recovery, payment-review and deployed-environment checks unfinished. Setup success alone does not verify those flows. No test financial records or receipt artifacts were created.
- Updated the task list, owner follow-ups, receipt guide and checkpoint. Documentation-only update; no SQL or application code changed, so no application test/build rerun was needed.

**Suggested commit message:** `docs(phase-05): record verified live receipt database activation`

### 2026-10-28 — live-backend receipt verification
- Ran local app route handlers/services against actual Firebase Auth/Firestore and Supabase metadata/private Storage using disposable, prominently marked synthetic receipt images. Existing admin ID token authorization and customer session scopes were exercised without creating auth users or changing security settings.
- Verified private owner/admin image access, foreign/anonymous/customer-OCR denial, format rejection, real Tesseract extraction, unreadable evidence, reviewed amount mismatches, reused references, upload/link/correction interruptions, replacement links, expired leases, concurrent worker/approval idempotency and orphan cleanup. Real missing-object OCR failed three times then stopped without financial effects.
- Verified public receipt upload before profile creation, pending visitor check-in and receipt/session binding, preserved ID/attendance through admin verification, and daily rejection preserving the incurred charge/visit.
- Source reporting initially required a missing Firestore index. Deployed only the saved indexes and waited for building to finish; report queries then passed. No rules, hosting or schedules were deployed.
- The main run passed 12 grouped checkpoints; missing-artifact and public-registration runs also passed. Original pricing audit and rates were preserved; all synthetic customer/financial/session/receipt fixtures were removed, reports returned to zero, and the monotonic Tibay sequence was not rewound.
- Completed this phase's verification requirement. Existing automated edge-case tests complement these live checks. Production hosted runtime and the full phone/browser walkthrough remain Phase 8 follow-ups. No real money was transferred or real customer payment approved.
- Evidence: documentation/receipt-gcash-live-verification.md. Temporary harness files were removed. No application code or SQL migration changed, so no new build was required.

**Suggested commit message:** `docs(phase-05): record live receipt and GCash verification`
