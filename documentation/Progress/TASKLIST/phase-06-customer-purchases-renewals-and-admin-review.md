# Phase 06 — Customer Purchases, Renewals, and Admin Review

**Status:** complete — existing automated cash/stale-review coverage and October 28 live-backend synthetic GCash flow passed; whole phone/browser walkthrough remains a Phase 8 follow-up
**Task list:** documentation/TASKLIST.md
**Publication:** implementation verified on origin/main at 21998c87fd28da9f222e12e08475ef90b032b750; live-backend GCash verification completed October 28 and recorded below

**Task list items covered:**

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

## Log

### 2026-10-25
- Added restricted customer quote/submission/status/replacement interfaces, configured single-month pricing and coverage previews, private receipt submission when available, and preserved separate profile verification.
- Added atomic admin profile plus pending membership creation, reviewed renewal/conversion submissions, Renewal Requests/Daily payment tabs, private receipt/reference visibility, explicit approve/reject actions and rejection reasons.
- Approval compares the displayed final coverage and receipt-review revision inside Firestore, requires refreshed membership acknowledgment, claims GCash references, recognizes purchases, extends membership once and appends audit evidence atomically. Delayed expired renewals start on approval date; active future expiry and calendar month-end behavior are preserved.
- Added stable submission receipts and per-person pending guards; linked replacements retain the original charge and price/category snapshot. Daily review never modifies membership or erases attendance.
- Closed legacy direct renew/convert/undo paths that bypass payment review. Explicit manual date/status corrections require an audited reason and do not claim a sale. Existing identity, card, visits and weights remain intact.
- Verification: npm test passed (54 files, 364 tests), npm run lint, npx tsc --noEmit and npm run build passed. Includes real local OCR/SQL checks from Phase 5, synthetic cash/GCash approval, duplicate references, stale/concurrent/repeated decisions, admin profile creation and customer-ID boundaries.
- Live GCash/receipt end-to-end verification remains unchecked because the live SQL migration is not applied. Longer/package/custom-expiry prices remain unavailable pending policy. See documentation/OWNER-FOLLOWUPS.md and documentation/purchases-and-review.md.
- Owner authorized proceeding to independent Phases 7–8 while access/input-dependent items remain pending. A usage checkpoint will defer continuation until the five-hour reset to preserve the requested buffer.

**Suggested commit message:** `feat(phase-06): add reviewed purchases and exactly-once membership activation`

### 2026-10-28 — GCash verification completed
- Verified live-backend Student PHP 600 and Regular PHP 700 membership submissions through protected route handlers, stored private evidence, real OCR and reviewed decisions. Pending/unreadable/mismatched/reused-reference submissions did not activate membership.
- Verified rejection/replacement retained one charge, repeated/concurrent decisions applied coverage once, guest attendance history stayed intact, restricted customer status remained minimal, and source reporting reconciled daily plus membership collections before teardown. Existing automated tests cover cash methods and stale membership previews.
- Earlier Phase 5 activation/GCash blockers are resolved. Hosted runtime/full phone UI checks remain separately tracked in Phase 8; these tests used the local Node runtime against live backends and no real GCash transfer.
- Removed all disposable fixtures after checking ordinary deletion retention. See receipt-gcash-live-verification.md for scope, failure injection and cleanup proof.

**Suggested commit message:** `docs(phase-06): record verified live-backend GCash purchases`
