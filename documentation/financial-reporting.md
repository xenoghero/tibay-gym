# Financial reporting

Overview retains its live attendance listeners. Collections refresh on entry, every minute while Overview is mounted, on window focus, and with Refresh collections. Statistics opens on Collections, with separate Attendance and Renewals tabs. Each report retains its own filters when switching tabs; attendance and renewal exports sit with their respective reports. Collections uses a compact comparison for a single day and a labelled trend for longer periods. On mobile, date controls open in a modal bottom sheet and financial records expand into details. All-date outstanding requests remain separate from selected-period totals.

Choose a Philippine calendar day, Monday–Sunday week, calendar month, or an inclusive custom range of at most 366 days. Pending figures describe the current state, rather than reconstructing a historical end-of-day queue.

| Figure | Source and attribution |
|---|---|
| Expected | All incurred daily charges by visit date, plus approved membership purchases by recorded purchase date |
| Pending daily | Current pending requests for daily charges whose visit date is in the selected period |
| Pending membership | Current pending requests whose original membership charge/submission date is in the period; excluded from expected purchases until approved |
| Confirmed | Approved payments by confirmation date, including collections for older visits |
| All open renewals/new memberships/daily payments | Current pending requests across all dates, separately displayed from period figures |
| Cash / GCash | Confirmed amounts by payment method; pending method amounts are labelled separately |

A daily charge remains expected after payment rejection because attendance incurred the charge. An RFID visit with no payment selection has an expected charge and no pending request. “No submission” identifies this case. Rejected membership submissions do not become purchases. Replacements share the original charge and its immutable price/category snapshot. A later rate change or customer deletion does not change historical totals. Profiles and present-day rates are not report inputs. No historical attendance is converted into invented payments; collection recording starts at the explicit Settings cutover.

The ledger contains one row per charge, with its current linked request status, purchase/visit date, confirmation date, and flags showing which totals include it. Tibay numbers and internal customer IDs support tracing without disclosing names, phone numbers or receipt contents. Amounts are integer centavos, formatted as PHP. Exact daily amounts and counts accompany the trend chart.

## Access, consistency and volume

GET /api/finance/report requires an authorized admin token and returns no-store responses. Source queries and linked records are read in one read-only Firestore transaction. Charges are queried by charge date and membership recognition time; payments by confirmation time and current pending status. Pages contain 500 source documents; the displayed ledger has 50 rows per cursor. Missing charge/payment links, mismatched amounts or conflicting current payment states withhold the report rather than publish unreliable totals.

Each source query has a 5,000-document limit. Exceeding it returns an explicit error, never truncated totals. Choose shorter periods when applicable. If the global pending queue exceeds the limit, an administrator must reconcile it or implement a measured, rebuildable summary strategy before reporting resumes. No summary documents or unbounded browser collection listeners were introduced. Deploy the paymentRequests status/submittedAt index in firestore.indexes.json with the matching app.

Ledger pages carry a hash of the full reconciled report. If underlying data changes between pages, the interface requires a refresh instead of mixing snapshots. Refresh also recovers network failures. Date controls, tables, loading/error/empty states and a horizontally contained ledger support narrow screens; all monetary totals are withheld during a failed refresh.

Automated reconciliation covers changed rate snapshots, Student/Regular charges, rejected requests, pending membership requests from earlier dates, delayed confirmations, Philippine midnight, Monday weeks, leap months, missing links, duplicate approvals, query pagination, source limits, authorization, empty states and client recovery. These checks use synthetic records and do not constitute live GCash verification.
