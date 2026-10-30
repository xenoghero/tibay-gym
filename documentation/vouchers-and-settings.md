# Vouchers and account settings

Implemented October 29, 2026 after acceptance of `vouchers-and-settings-project-plan.md`.

## Admin workflow

Open **Account settings → Vouchers**. Create a generated or manually entered code, name the campaign, and choose fixed PHP or percentage savings. Percentage precision is two decimal places; calculation rounds down once to whole centavos. A percentage discount may have a maximum PHP cap.

Choose one or more purchase types (Daily session, Membership renewal, New membership) and Student/Regular categories. Optional minimum base price, start/end dates, total uses, and uses per customer restrict availability. Date fields use Philippine time; the end time is exclusive. At least PHP 1 must remain payable, and a voucher must actually reduce the price. There is no stacking or retroactive daily discount.

New codes become available when their schedule allows. Pause prevents new submissions. Resume still respects dates and capacity. Unused codes can be renamed or deleted; retired spellings cannot be recycled. Once any charge has used a code, its spelling stays fixed and deletion becomes Archive. Other rule edits create a new revision and preserve submitted transactions.

The list shows held/confirmed counts and capacity bars. Search, filters, and aggregate figures cover the loaded list, with explicit labels; Load more extends it in batches of 50. Details include full rules, private notes, and paginated usage, with customer names/retained IDs, transaction numbers, payment outcomes, original price, discount, and payable amount. Refresh obtains current counts.

**Pricing** now compares Student/Regular daily and monthly rates. Edit prices → Review changes → Save changes displays old/new amounts before writing. Unconfigured monthly pricing remains unavailable. Conflicts preserve the draft and show the latest saved rates for comparison. **Account & security** retains the existing email, reauthentication/password reset, and sign-out behavior. Section links persist in the URL hash, and switching sections preserves drafts. Tables become labeled lists/groups on narrow screens.

## Customer and administrator purchases

- Public daily payment: identify the customer, expand Have a voucher?, apply it, review the breakdown, and select Cash/GCash. Covered active members keep their ordinary attendance flow. The customer portal links guests/expired members to daily check-in.
- Customer membership: choose 1, 2, 3, 4, or 5 months, or one year (12 months). The base price is the configured monthly rate multiplied by the duration, with no automatic package discount. Apply one voucher to the full purchase total before payment. The server determines whether it is a renewal or a new membership. A renewal-only code cannot be used for a guest's first membership. The selected duration is included in the quote, receipt validation, stored charge quantity, and approval coverage. Rejected-payment corrections retain the original duration and price. Approval extends an active membership from its current expiry, or starts an expired membership on the approval date, adding calendar months and clamping to the destination month's last day where necessary.
- Admin-assisted renewal/conversion and new-profile membership creation also support voucher entry.
- Changing/removing a code refreshes the authoritative quote and clears receipt evidence tied to the previous amount. The receipt upload and approval checks use the net payable amount.
- A same-day return never creates another charge or voucher use. RFID has no code-entry step and does not select promotions automatically.
- Rejected payment corrections retain their original charge, discount and held use. They cannot swap or remove the voucher. Payment review and customer history show the discount alongside the payable amount.

## Capacity and settlement

Previewing a code consumes no use. Creating a charge atomically reserves total and per-customer capacity, with the financial records, operation receipt, and audit evidence. Approval moves held → confirmed once. It honors submitted terms even after pause/archive/expiry or later rate edits.

Rejected payments retain their reservation because a corrected request retains the agreed amount. For an abandoned **unpaid membership purchase**, use Close abandoned membership request in Payment review, or Close abandoned request in voucher usage details. Enter a reason and confirm. This atomically releases capacity, clears the applicable pending-membership guard, and blocks approval/correction of that purchase. It is safe against concurrent approval and repeated clicks. The history remains available even if the customer profile has been deleted.

Daily visits have already incurred a charge, so they cannot release their discount through abandonment. There is no silent expiration of a submitted reservation. Approved purchases cannot be abandoned.

## Storage and access

New Firestore collections: `vouchers`, `voucherCodeClaims`, `voucherUses`, `voucherCustomerUsage`, `voucherOperations`. Existing default-deny rules already block browser access; authenticated admin APIs and protected server transactions own mutations. Queries use existing automatic single-field indexes; no Supabase migration, new secret, or additional dependency is required.

Charges retain base/discount/net amounts and voucher terms; `amountMinor` remains net payable, preserving existing collection totals and receipt matching. Legacy charges lacking these optional fields retain their existing amounts. Quotes are bound to the customer/category/purchase context and rate/voucher revisions. New-profile quotes are restricted to the existing authenticated admin creation flow.

Audit records capture rule changes and reservation/confirmation/release transitions. Private notes are not returned to customers or written to audit snapshots. Code claims survive unused-voucher deletion to prevent reuse. Used voucher/use records are retained with financial history.

## Verification and limits

Automated checks cover integer rounding, eligibility, schedules, total/per-customer capacity, last-slot competition, retries, customer-bound quotes, stale revisions, rejection/correction, same-day returns, atomic profile creation, abandonment versus approval, retired code uniqueness, and discounted GCash evidence. DOM tests cover pricing review, code-specific management confirmations, voucher configuration payloads, quote breakdown/removal, and receipt clearing.

Production build and local automated checks were run; this work does not deploy the app or create any live vouchers/purchases. Rendered browser verification could not proceed because the Computer Use tool could not reliably determine the Windows browser URL. Desktop/mobile visual appearance and real-device checkout remain manual verification items; DOM tests are not a visual inspection.

Deferred: free sessions, stacking, referrals, automatic promotions, bulk unique-code generation, financial refunds/voids, package/custom-duration prices, and stronger identity verification than the existing customer profile model.
