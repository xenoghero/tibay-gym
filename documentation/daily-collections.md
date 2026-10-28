# Daily attendance and collections

Financial cutover starts with the first explicit pricing save. Before cutover, existing attendance remains operational without invented charges. Admins must classify chargeable existing customers as Student / Regular; covered memberships need no daily category/payment prompt.

- New chargeable check-ins atomically create the visit, one customer/Philippine-date charge, and the pending cash request selected by the visitor. The server compares the displayed daily amount before committing and asks for a refreshed review if prices changed.
- A same-day charge key is hashed into a stable charge document ID. Same-day returns, checkout, retries, concurrent scans and pending-profile approval reuse that identity. Original pricing snapshots remain unchanged by later settings edits.
- Covered active members keep ordinary attendance. An expired member can choose a daily session on the QR page; this never changes membership standing/expiry. Existing RFID expired-member rejection remains intact; use the QR daily option or admin renewal. A guest RFID check-in records the expected daily charge without inventing a payment method; the admin can later review and confirm cash.
- Cash selection is pending, not money received. Payment review lists bounded/paginated daily charges. The admin reviews the customer ID, date, category and amount, confirms that the cash was received, then commits confirmation. A charge can be confirmed once; repeated clicks return the same outcome. Actual confirmation time determines the collection date.
- Attendance and financial review remain separate. Later rejection does not remove the visit or the incurred daily charge. Replacements/review of GCash follow in Phases 5–6.
- GCash request/receipt links exist in the financial contract, but this phase rejects GCash submission and disables the selector until Phase 5 provides a validated private receipt path. No fake/missing receipt can become a pending GCash payment.
- Tibay transaction-number allocation is a Phase 5 dependency; Phase 4 reserves its field without presenting an invented number.

All mutations retain minimal audit evidence and preserve membership/history. Production app/rules/index rollout and hardware verification remain Phase 8 readiness checks.
