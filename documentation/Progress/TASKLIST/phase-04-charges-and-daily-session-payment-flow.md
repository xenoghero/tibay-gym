# Phase 04 — Charges and Daily-Session Payment Flow

**Status:** complete
**Task list:** documentation/TASKLIST.md
**Publication:** verified on origin/main at fbbc75943c74a80aef840152bfe978549765232c

**Task list items covered:**

- [x] **Build:** Record one expected daily charge per customer per Philippine date, including pending visitors; preserve the association during approval.
- [x] **Build:** Show Cash / GCash only when payment is due; active covered members retain ordinary attendance without a daily payment prompt.
- [x] **Build:** Allow expired members to choose a chargeable daily session and check in while retaining expired membership and existing history.
- [x] **Build:** Create pending cash requests and allow direct admin cash confirmation through an explicit reviewed action; retain audit evidence.
- [x] **Build:** Define pending GCash request/receipt-link handling and immediate attendance semantics; complete public upload wiring in Phase 5 and admin review in Phase 6.
- [x] **Build:** Keep unfinished GCash submission unavailable until Phase 5 supplies a valid receipt-upload path; do not accept a fake or missing receipt as a completed GCash submission.
- [x] **Build:** Keep visits independent of payment review, so later rejection does not erase attendance or extend membership.
- [x] **Verify:** Check same-day returns, checkout, repeat submissions, concurrent check-ins, lost responses, midnight boundaries, and visitor approval for duplicate charges.

## Log

### 2026-10-25
- Added daily customer/date charge claims and pending cash writes in the attendance transaction; stable scan receipts, price snapshots and explicit amount review prevent duplicate or silently repriced purchases.
- QR check-ins prompt for payment only when due, covered members keep existing attendance, and expired members can select daily attendance without membership extension. Existing RFID expiration policy remains intact; chargeable guest scans produce expected charges without inventing a payment method.
- Added paginated admin daily payment view and explicit cash-received review, amount comparison, exactly-once confirmation marker and audit evidence. Review leaves attendance and membership untouched.
- Defined GCash/receipt-link contract and rejects/disables GCash until Phase 5's valid upload path. Reserved Tibay number field is not shown as an invented number.
- Verification: npm test passed (43 files, 330 tests); npm run lint, npx tsc --noEmit and npm run build passed. Tests cover lost responses, same-day returns, concurrency, midnight, approval identity preservation, stale prices, frozen/unclassified profiles and repeated cash confirmation.
- Files: daily-charge service/tests and route, attendance/lookup/state-machine integration, cash-review UI/navigation, contracts/audit allowlist, indexes and documentation/daily-collections.md.
- Existing profiles still require admin category completion before chargeable daily visits. No historical payments were backfilled and no live financial mutations were performed.

**Suggested commit message:** `feat(phase-04): record daily charges and reviewed cash collections`
