# Phase 07 — Overview and Financial Statistics

**Status:** complete
**Task list:** documentation/TASKLIST.md
**Task list items covered:**

- [x] **Build:** Show today's expected collection amount on Overview, split into daily sessions, renewals, and new memberships.
- [x] **Build:** Keep currently-in-the-gym counts and recent check-ins real-time alongside the new figures.
- [x] **Build:** Clearly distinguish expected charges, pending payments, confirmed collections, and separately displayed pending renewal requests.
- [x] **Build:** Make finance the main Statistics content with daily, weekly, monthly, and selected-date totals and transaction counts.
- [x] **Build:** Add collection trends and purchase-type breakdowns, plus Cash / GCash and pending / confirmed distinctions.
- [x] **Build:** Apply Philippine reporting dates, Monday-start weeks, purchase-date attribution, and confirmation-date attribution consistently.
- [x] **Build:** Preserve useful existing attendance oversight; paginate/query underlying financial records and introduce rebuildable summaries only if required by volume.
- [x] **Verify:** Reconcile figures with source records across rate changes, pending/rejected submissions, delayed confirmations, and date boundaries.

---

## Log

### 2026-10-26
- Added today's expected daily/renewal/new-membership breakdown, confirmed and pending amounts, all-date outstanding renewals, and manual/minute/focus refresh to Overview; preserved all existing live attendance listeners.
- Made finance the main Statistics content with Philippine date/day/week/month/custom controls, source-based totals/counts, method/type breakdowns, trends with exact accessible values, and a 50-row ledger. Preserved attendance charts, exports and expiry watch below it.
- Added an admin-only, uncached report route with consistent read-only transactions, 500-document query pages, explicit 5,000-record source caps and reconciliation failures. Added the pending-request query index. Price/category snapshots survive rate changes and profile deletion. Changed-source page hashes prevent mixing ledger snapshots.
- Extended the test-only Firestore subset for chained range queries, ordering, cursors and multi-document joins. Added pure reconciliation, service pagination/volume/access and client recovery/date/paging tests.
- Files: lib/finance/report*, lib/server/finance-report*, app/api/finance/report/*, dashboard finance/Overview/Statistics, globals.css, firestore.indexes.json, test fixtures/helper, documentation/financial-reporting.md.
- Executed npm test: 57 files / 371 tests passed before the final three client tests; those three tests passed separately. npm run lint, npx tsc --noEmit and npm run build passed. Final lint/types are checked again before publication. No real transactions were written.
- Live receipt activation/GCash and hosting rollout remain the owner-dependent items recorded in OWNER-FOLLOWUPS.md. These do not block independently verified reporting implementation, per owner instruction.

**Suggested commit message:** `feat(phase-07): add reconciled financial overview and statistics`

**Publication:** 0b57998a16349c2c8e6b4171bd6f820cac2eb59a verified as origin/main after push; ancestry and local/remote hashes matched.
