# Non-SMS operations — phases 1 through 8

## Before using the financial workflow

1. Review Admin Settings. As approved and saved on October 28, 2026, daily rates are PHP 60 Student / PHP 70 Regular and one-month membership rates are PHP 600 Student / PHP 700 Regular. Saving these rates established the explicit financial cutover. Existing attendance is not backfilled as invented charges or payments. No official or pending profiles existed at setup; complete any later missing Student / Regular classifications before chargeable visits or purchases.
2. Review OWNER-FOLLOWUPS.md before rollout. Publish the matching app and private server configuration, then enforce its Firestore rules/indexes. Existing direct browser writes are intentionally denied by the revised rules; applying them before the matching app can interrupt the old interface.
3. Keep GCash unavailable until receipt SQL/security readiness succeeds. Cash needs no SMS or receipt/OCR provider. No application in phases 1–8 sends SMS.

Only one daily session or one month has defined pricing. Package, longer-term and custom-expiry purchases stay unavailable until their prices are agreed. Test examples in the automated suite and local preview are synthetic, not proposed business prices.

## Registration, access and attendance

Customers choose Create Account or Check In. Registration requires Student / Regular and a lead source, with details for Others. The first visitor remains pending until admin verification; approval preserves the customer ID, category, photo, visits and financial links. Optional photo failure does not undo registration or attendance.

The customer page uses a saved phone number without OTP, as requested. It exposes limited membership and payment status, not a full profile or admin controls. Its restricted session lasts 30 minutes. Sign out / use a different number revokes the server session and clears the cookie; retry if closing the session fails. The displayed account clears on expiry. Pending visitors can view their limited payment status; membership purchase submission requires a verified profile.

Covered active members retain normal check-in. An expired member can choose a daily visit through QR while retaining the expired membership. A daily request does not renew membership. RFID keeps the established expired-member rejection policy. Scanner visits without a payment selector can incur an expected charge with no submitted payment request.

One customer/date incurs at most one daily charge, even with same-day returns, concurrent scans or response retries. Checkout and attendance corrections remain separate. Payment rejection preserves the visit and its incurred charge. Do not repeatedly switch actions after a connection failure: use the displayed retry/recovery action and inspect status before starting another operation.

## Receiving and reviewing money

- **Cash:** customer submission is pending, not a receipt of funds. In Payment review, inspect the amount, customer, dates and evidence, then explicitly confirm actual money received. A scanner charge without a request can use Review cash received. Linked replacement requests are reviewed in the request list, using their stored method rather than their identifier format.
- **GCash:** upload a JPG/PNG/WebP receipt up to 5 MB for money already sent to the gym's confirmed account. The software does not initiate a transfer. Pending daily GCash submission allows the visit after a valid receipt link; it does not confirm collection or extend membership.
- **Receipt review:** compare the private image and received GCash transaction. OCR is a suggestion. Confirm/correct the reference and amount with a short operational reason, then save. Saving evidence still requires a separate payment approval. Keep leading zeros in references. A reused approved reference or mismatched reviewed amount blocks approval.
- **Membership approval:** inspect final coverage. Active membership extends from its current expiry; expired membership starts on the approval date. If membership changed, refresh and accept the displayed coverage before approval. Rejection requires a reason and does not require accepting new coverage. Repeated/concurrent approval applies the purchase once.
- **Rejected submissions:** the customer can submit a linked replacement after profile verification. It retains the original charge and price/category snapshot, so it does not create another daily charge or membership sale. A previous pending membership request must be decided before another purchase can be submitted.

New member creation and guest conversion create reviewed pending purchases. The existing profile-verification step remains separate. Do not infer membership activation from a pending purchase or upload. Manual membership corrections require a reason and are audited; they do not create a sale. Corrections/voids of approved financial transactions are outside this extension.

## Reading reports

Overview keeps live attendance and adds today's financial figures. Finance refreshes on entry, every minute, on focus or explicitly; attendance still uses its real-time listeners. Statistics contains calendar day/week/month and selected-date reports, counts, trends, type/method breakdowns and a paginated ledger. Existing attendance charts, CSV export and expiry watch remain available below finance.

Expected means daily charges plus recorded approved membership purchases. Pending membership requests are displayed separately. Confirmed means actual approved payments, attributed to confirmation date. Delayed payment can therefore raise today's confirmed collections for an earlier visit. Pending values show the current queue, not a reconstructed historical balance. All open renewals cover all dates. See financial-reporting.md for exact attribution and source limits.

Reports use Philippine dates and Monday-start weeks, stored centavos and immutable category/rate snapshots. A later rate change or profile deletion does not rewrite totals. If a report refuses inconsistent or excessive records, reconcile them or choose a shorter period; never interpret an error as zero money. Refresh when records change between ledger pages.

## Audit, privacy and recovery

Audit history supports date, action, record and customer filters with pagination. Operational changes record actors, dates, reasons and permitted changed values. Avoid entering names, phone numbers, addresses, birth dates, credentials or receipt contents into free-text reasons. Do not place server keys in browser settings or NEXT_PUBLIC variables.

Ordinary profile deletion removes private profile/attendance/weight records, blocks customer/image access and queues photo cleanup. Receipt evidence follows the approved October 28 policy even after deletion: rejected/replaced evidence 180 days after final rejection; approved evidence protected until confirmed filing-based five-year accounting expiry; pending reviews, dispute and legal holds protected. Minimal financial/audit history remains. In Payment review, use Retention and holds on a payment row (including a deleted customer) to manage holds and confirmed accounting dates. Run retention cleanup processes eligible receipt/photo evidence locally; it also runs one OCR job. Protected jobs must actually run; outages delay physical removal. See audit-and-retention.md. Hosting/schedules remain deferred.

Receipt processing uses durable intents/outboxes, leased OCR claims and bounded retries. Interrupted upload/link/review steps remain recoverable. An admin can process the next queued receipt or request OCR retry; unreadable evidence stays for human review. Schedule protected POST /api/receipts/worker with a private CRON_SECRET of at least 20 characters, and arrange protected profile-image cleanup. Verify Node workers, sharp, bundled English OCR data and the worker's 120-second runtime budget on the actual host.

For live activation, apply supabase/migrations/202610250001_private_receipts.sql using SQL Editor or a private SUPABASE_DB_URL, then run npm run receipts:setup. Read receipts-and-ocr.md before operating the worker. Do not publish storage objects or weaken readiness to enable GCash.

## Return-to-work checklist

Read OWNER-FOLLOWUPS.md and receipt-gcash-live-verification.md. Receipt SQL readiness and local app checks against live Firebase/Supabase are complete. Remaining checks concern the full phone/browser walkthrough, hardware, policy decisions and deferred deployment/schedules. Automated and live-backend evidence are recorded separately; no hosted runtime or real GCash transfer is claimed. Local SMS implementation is documented in SMS-OPERATIONS.md; it remains disabled pending gateway/device setup and delivery checks and is independent of the financial workflows above.
