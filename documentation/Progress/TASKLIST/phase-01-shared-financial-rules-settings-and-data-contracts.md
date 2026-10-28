# Phase 01 — Shared Financial Rules, Settings, and Data Contracts

**Status:** complete
**Task list:** documentation/TASKLIST.md
**Publication:** verified on origin/main at 4f1e2fd16ef39d06d2d5eb3ef588aaf88790313b

## Log

### 2026-10-25
- Added non-SMS money, pricing, charge, request, receipt-link, customer-session and reference-claim contracts; legacy profile category remains optional/null.
- Added authenticated Admin Settings pricing with bounded validation, revision conflicts, stable retry receipts and first-save financial cutover. No historical payment backfill or existing attendance changes.
- Added immutable price snapshots, Philippine financial date keys, Monday weeks, daily uniqueness key contract and separate expected/pending/confirmed reconciliation.
- Only single-month pricing is defined. Longer packages and custom-expiry purchase pricing remain blocked pending the explicit policy in the plan; existing non-financial membership tools are preserved.
- Files: lib/finance, lib/server/finance-settings*, app/api/finance/settings, dashboard pricing component and integration, profile contract, finance-contracts notes, task list.
- Verification: npm test passed (32 files, 277 tests); npm run lint passed; npx tsc --noEmit passed after correcting two typing errors; npm run build passed. Tests use in-memory records, no live financial data was written.
- Publication will be verified against origin/main before Phase 2 begins.

**Suggested commit message:** `feat(phase-01): add financial contracts and configurable collection rates`

**Task list items covered:**

- [x] **Build:** Define non-SMS contracts for charges, payment requests, customer sessions, receipt links, reference claims, and relevant existing-profile extensions; leave SMS models for Phase 9.
- [x] **Build:** Add Student / Regular category independently of Member / Guest; represent unclassified existing customers without fabricating a category.
- [x] **Build:** Add configurable daily/monthly rates in Admin Settings, with PHP 60 Student / PHP 70 Regular daily defaults and monthly prices unset.
- [x] **Build:** Validate configured prices and prevent membership purchase submission when its applicable rate is unset.
- [x] **Build:** Store amounts in integer centavos and define category/rate/coverage snapshots so settings changes never rewrite past purchases.
- [x] **Build:** Standardize charge/reporting dates on Asia/Manila with Monday-start weeks; define purchase-date versus confirmation-date attribution.
- [x] **Build:** Define separate expected charges, pending requests, and confirmed collections, including pending daily charges and separately displayed pending renewals.
- [x] **Build:** Establish daily customer/date uniqueness, stable operation identifiers, and the financial cutover without historical payment backfill.
- [x] **Verify:** Check rate validation, unset monthly rates, date boundaries, snapshot stability, and compatibility with existing profiles.

### 2026-10-28 — owner-approved live pricing
- Owner specified Student PHP 600 and Regular PHP 700 for one-month membership, retaining PHP 60 / PHP 70 daily rates. Package/custom-expiry pricing remains unavailable.
- Read the configured live Firestore project: no finance settings document, zero official profiles and zero pending profiles. There were no existing customers to classify or historical payments to infer.
- Applied the approved settings through the existing saveFinanceSettings service, using a stable operation ID and the explicit operator:owner-approved-pricing actor for this owner-authorized administrative action. No direct unaudited settings write was used.
- Read back all four amounts and revision 1; verified the matching rates-update audit event and purchase snapshots of 60000 / 70000 centavos. The explicit financial cutover is 2026-10-28T03:17:17.948Z (11:17:17 Asia/Manila). No charges or payment requests were created by configuration.
- Executed targeted finance settings/rules tests: 2 files / 20 tests passed. No application code changed, so a new production build was unnecessary. Removed temporary local execution files and updated operating notes, follow-ups, checkpoint and task list.

**Suggested commit message:** `docs(phase-01): record approved monthly rates and verified cutover`
