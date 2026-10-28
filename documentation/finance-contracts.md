# Financial contracts and cutover

Phase 1 establishes contracts; attendance and purchase wiring follows in later phases.

- All financial values are positive safe integer PHP centavos. Daily defaults: Student 6000, Regular 7000. Monthly rates are null until configured; null never means free.
- Student / Regular is independent of Member / Guest. Absent or null category means unclassified. Do not infer category, lead source, or historic payment from an existing profile.
- Only a single daily unit or a single monthly unit has defined pricing. Longer packages and custom-expiry purchase amounts remain unavailable until an explicit pricing policy exists. Existing non-financial membership date tools remain unchanged in this phase.
- A charge snapshots category, rate revision, unit price, quantity, amount and requested/final coverage. Settings changes must not rewrite those snapshots.
- All charge and reporting date keys use Asia/Manila. Weeks start Monday. Daily expected amounts belong to the charge date; membership purchases become sales on recognition at approval; money received belongs to the confirmation date.
- Expected totals include daily charges even while pending or rejected. Rejection does not erase an incurred daily charge. Pending daily requests and pending membership/renewal requests are separate figures; pending membership requests are not sales. Confirmed collections require an approved request and confirmation timestamp.
- `dailyChargeKey(personId, timestamp)` defines the customer/date claim document key. A future charge writer must transactionally read and claim that key; pending visitor approval must keep the identity or migrate its claim atomically. A helper alone is not enforcement.
- Client mutations carry a stable operation identifier reused after network uncertainty. Settings stores a transaction receipt, rejects conflicting reuse, and compares rate revision before saving. Later writers must do the same within their authoritative transaction.
- The first explicit admin pricing save establishes `financialCutoverAt`, retained by subsequent saves. Before this, financial writes must remain unavailable. No historic attendance/payment backfill is permitted.
- Settings and operation receipts are private server collections under the existing deny-by-default Firestore rules; only the authenticated admin settings endpoint can access them. Settings reads do not initialize records.

Open decisions about package/custom-expiry prices, image retention, deletion anonymization, and review policy remain in the task list. They must be resolved before the dependent phase claims completion.
