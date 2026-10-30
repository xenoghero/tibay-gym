# Tibay Gym — Vouchers and clearer account settings
### Project Plan

Proposal dated October 29, 2026. This document proposes behavior and UI before implementation; it does not change application behavior or replace the existing TASKLIST.

Accepted by the owner and implemented October 29, 2026. The original proposal below is retained as design rationale; see `vouchers-and-settings.md` for implemented behavior, verification, and limits.

## 1. Overview

Add admin-managed voucher codes to daily sessions and customer membership purchases, with explicit eligibility, usage limits, and a preserved financial history. Keep pricing, vouchers, and account security within the existing admin settings destination. Extend the current server-authoritative charge/payment workflow so a voucher changes the quoted amount without bypassing payment review or changing membership rules.

Confirmed scope: generate, edit, restrict, disable, delete, and inspect voucher usage; apply codes in public daily check-in and customer membership flows; improve settings layout and controls. All policy details below are recommendations until accepted.

### Existing implementation reviewed

- `components/dashboard/account-settings-view.tsx`: a 640px maximum-width page with pricing above Login, Security, and Session groups; its description still refers only to the admin login.
- `components/dashboard/finance-settings.tsx`: four separately stacked price inputs, basic load/save controls, and inline status copy. Saves already use revision checking and stable operation IDs.
- `lib/finance/contracts.ts` and `lib/finance/rules.ts`: Student/Regular rates, integer PHP centavos, daily/new-membership/renewal kinds, immutable historical prices, and single-month pricing only.
- `components/checkin/checkin-flow.tsx`: public attendance and daily payment flow.
- `components/people/purchase-form.tsx`: shared purchase UI, including customer portal and administrator contexts.
- `lib/server/purchases.ts`: authoritative quotes, pending requests, linked replacements, receipt verification, and transactional approval.
- `documentation/purchases-and-review.md`: replacements preserve the original charge and amount; profile approval and payment approval remain separate.
- `app/globals.css`: existing white/warm surfaces, yellow accent, Geist body type, and Barlow Condensed display type, with dark-mode tokens.

This is a source audit; no rendered browser inspection or usability testing has been performed for this proposal.

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Application | Existing Next.js 16.3.3, React 19, TypeScript |
| Authentication | Existing Firebase admin authentication and restricted customer sessions |
| Financial authority | Existing Firestore transactions for charges, payment requests, settings, and audit events |
| Receipt artifacts | Existing private Supabase Storage/Postgres receipt system |
| Styling | Existing CSS variables and CSS modules; no new component dependency proposed |
| Verification | Existing Vitest and Testing Library tooling |

Read relevant installed Next.js guides before implementation. Voucher data belongs beside authoritative financial records in Firestore; this proposal requires no Supabase schema change.

## 3. Core Features

### Voucher rules

- **Code creation** — offer Generate code and a manual code field; normalize trim/case on the server and claim uniqueness transactionally. Suggested format: 6–24 uppercase letters, digits, or hyphens; generated codes avoid ambiguous characters.
- **Internal name** — allow a campaign label and private admin note; customer responses reveal only their relevant voucher terms.
- **Discount** — choose fixed PHP amount or percentage, with an optional maximum discount for percentage codes. Store amounts in centavos and percentage precision explicitly; calculate using integer arithmetic with one documented rounding rule.
- **Purchase scope** — separate checkboxes for Daily session, Membership renewal, and New membership. Renewal eligibility comes from the server's actual charge kind; a guest buying their first membership is not a renewal.
- **Category scope** — choose Student, Regular, or both. A code never substitutes for a missing customer category or an unconfigured monthly price.
- **Schedule** — optional start and end, displayed in the gym's Asia/Manila timezone. The end is exclusive; UI explains exactly when availability ends.
- **Limits** — optional total-use cap and per-customer cap; recommend one use per customer initially. Limits apply across all selected purchase kinds, with remaining capacity reduced by committed reservations.
- **Minimum purchase** — optional minimum eligible base amount, evaluated before the discount.
- **One code per purchase** — no stacking in the first release; eligibility and discounts always come from the server.
- **Positive payable amount** — recommend keeping at least PHP 1 payable for the first release. Reject a configuration/application that would fall below that amount, with a clear explanation. Free-entry vouchers need their own no-payment settlement flow and are deferred.
- **Scope consistency** — the same configured code behaves consistently in daily check-in, customer membership purchases, and equivalent admin-assisted purchase forms. RFID scans have no code-entry step; do not apply promotions automatically.

### Administrator control and usage

- **Generate / edit** — show a plain-language eligibility summary and sample price calculation before saving.
- **Safe changes** — allow edits to rules with a new revision; existing submitted charges retain their voucher snapshot. Keep the code text fixed after first submission; Duplicate creates a new code for a new campaign.
- **Pause / resume** — stop new applications immediately without rewriting existing charges. A paused code resumes only if its schedule and capacity still permit use.
- **Archive / delete** — archive used or reserved codes, retaining history. Permit permanent deletion only for never-submitted codes, with confirmation and a retained audit event; do not recycle retired code strings.
- **Usage counts** — show confirmed uses, held uses, available uses, and confirmed discount total separately. A held use belongs to a submitted unpaid charge, including a rejected request still eligible for correction.
- **Usage history** — show customer, purchase type, transaction number, base price, discount, payable amount, payment outcome, and submission/confirmation times. Count unique charges, not payment attempts or quote previews.
- **Audit** — record create, edit, pause, resume, archive, delete, and redemption transitions through authenticated server mutations.

### Settings UI/UX

Keep the existing Account settings destination. Change its description to “Manage gym pricing, vouchers, and your admin account.” Use three persistent section links: Pricing, Vouchers, Account & security. Preserve the selected section in the URL so refresh/back returns to the same place.

**Shared visual system (proposed extension of current tokens):** retain existing light/dark colors and fonts. Use body/labels at 14–16px, section titles at 22–24px, display page title at 36–46px; reserve monospaced type for codes and transaction identifiers. Use spacing steps 4/8/12/16/24/32px, 6–10px radii, hairline dividers, and flat surfaces. Align currency with tabular numerals. Yellow primary buttons use dark text; destructive actions use an explicit danger treatment distinct from the brand accent.

**Wide layout, at least 1100px:** use the available dashboard content width up to roughly 1120px, replacing the current 640px restriction. Place a 190px settings section rail beside a flexible content pane. Keep the existing dashboard navigation. Each section has one title, short supporting copy, and one principal action.

**Intermediate layout, 700–1099px:** move section navigation above the content as three compact links. Keep pricing comparison and voucher rows where they fit; move secondary voucher details into an expandable row before horizontal overflow occurs.

**Narrow layout, 360–699px:** use the same three links above the content, 16px side padding, stacked forms, and labeled voucher list items. Every desktop field remains available in the editor/detail view. Use a full-page voucher editor; keep save controls in normal flow or above the existing mobile navigation with sufficient bottom space. No page-wide horizontal scrolling.

#### Pricing section

- Desktop: one compact comparison table with Category, Daily (PHP), and Monthly (PHP), and rows for Student and Regular. Right-align values; distinguish “Not configured” from zero. Show last updated time and the rate revision as supporting information.
- Mobile: two clearly labeled groups, Student then Regular, each containing daily and monthly fields. Retain the same information and save behavior.
- Editing: show explicit Edit prices, followed by Save changes and Cancel. Disable save when unchanged or invalid; show field-specific errors. On save, summarize changed old/new values for review. Explain that existing submitted purchases retain their prices.
- Unconfigured monthly rates: show a clear availability message; a voucher cannot activate an unavailable membership product. Clearing a monthly rate explicitly warns that new purchases for that category become unavailable.
- Loading/error: show a loading state initially, Retry on failure, and preserve typed values after save failures. On revision conflict, offer comparison/reload rather than silently discarding edits.
- Rationale: the two-by-two comparison makes student/regular differences easier to scan than four unrelated inputs.

#### Vouchers section

- Header: Vouchers, concise explanation, primary Create voucher button.
- Summary strip: Available codes, Confirmed uses, Confirmed discounts (PHP), labeled All time. These are supporting values; avoid a chart without a time-series question.
- Toolbar: code/name search and status filter (All, Available, Scheduled, Paused, Expired, Limit reached, Archived). Preserve filters and pagination when returning from details.
- Desktop table: Code/name; Discount; Applies to/category; Availability; Usage; Actions. Example usage: “18 confirmed · 2 held / 100”. A small labeled capacity bar may supplement the numbers for capped codes; never use color alone.
- Each row: Copy code and View details are visible; Edit, Pause/Resume, Duplicate, Archive/Delete appear in a labeled More actions menu. Do not use a destructive icon beside Copy.
- Mobile item: code + status first, discount + applicability next, usage + validity next, then Copy and View details. All management actions remain accessible in details.
- Editor: use a broad panel on desktop and a full page on mobile. Group Identity, Discount, Eligibility, Schedule & limits. Show a live example based on configured eligible rates and a written rule summary, clearly labeled as a preview.
- Details: show the complete rule set, usage counts, and paginated history. Desktop uses a table; mobile uses labeled transaction summaries. Missing/archived customers retain a minimal historical identifier.
- States: first-time empty state offers Create voucher; filtered empty state offers Clear filters. Show real loading/error states rather than zero metrics while fetching. On write conflicts, keep the draft and explain what changed.
- Confirmation: pause explains that existing submissions keep their discount; archive explains preserved history; permanent deletion names the unused code. Resume explains schedule/limit blockers when unavailable.
- Rationale: rule summaries and explicit held counts explain both eligibility and capacity without forcing the admin to inspect each payment.

#### Account & security section

- Group existing email, password change/reset, and sign-out controls under clear labels. Preserve current reauthentication and feedback behavior.
- Keep this section at a comfortable form width even though pricing/vouchers use a wider content pane.
- Mobile keeps the same reading order, with full-width form controls and sign-out separated from save actions.
- Show pending, success, and actionable field errors for password/reset actions; preserve visible keyboard focus when panels open and close.

### Customer and check-in UI/UX

- **Daily check-in:** show “Have a voucher?” after identifying a chargeable customer and before choosing/payment submission. Expanding reveals a labeled Code input and Apply button. Covered members do not see a daily discount prompt.
- **Customer membership purchase:** place the same control beside the quote summary before Cash/GCash and receipt upload. Distinguish Start membership from Renew membership using the authoritative quote kind.
- **Quote breakdown:** show Base price, Voucher CODE (negative PHP amount), and Total to pay, with total visually strongest. Keep coverage preview and the existing admin-review notice visible.
- **Applied state:** display code, benefit, and Remove. Editing the input does not silently change the accepted quote; require Apply again. Lock quote-changing controls while submission is in progress.
- **Failure state:** explain invalid/unavailable, expired, not started, wrong purchase/category, minimum not met, and limit reached in plain language. Keep input intact and allow removal or another code. Throttle guessing and never reveal other customers' usage.
- **Stale quote:** refresh and require review if base pricing, voucher revision, or availability changes before submission. A displayed preview never guarantees the last available slot.
- **GCash:** establish the discounted payable amount before receipt upload. Changing the quote invalidates/revalidates any receipt proof bound to the old amount; do not submit an old upload token against a new quote.
- **Repeat daily visits:** preserve the existing one-charge-per-customer-per-Philippine-day rule; a return visit cannot add/change a code or count another redemption against that existing charge.
- **Corrections:** rejected payment replacements retain the original discounted charge and redemption; they do not offer a second voucher application.
- **Admin review/history:** show base, discount, net payable, and code; verify cash/receipt against net payable. Keep expected collections, pending amounts, and confirmed receipts distinct.

**Shared interaction acceptance targets:** native labeled controls; visible focus; keyboard-accessible menus/panels; focus return on close; inline errors associated with fields; announced async results; text alongside status colors; at least 44px action targets; 16px input text. Verify reflow at 360/390/768/1024/1440px and at enlarged text in light/dark themes. These are project targets, not a claim of tested accessibility compliance.

## 4. Voucher Lifecycle

```text
enabled ↔ paused
enabled / paused → archived
never-submitted enabled / paused → deleted (retained code tombstone + audit)
```

- Scheduled, available, expired, and limit reached are derived availability labels, not additional stored statuses. Archived/deleted/paused take precedence; remaining reasons stay visible in details.
- Availability requires enabled status, a matching schedule/scope/category, eligible positive base price, and capacity.
- Pause/archive/expiry affect new submissions. Submitted charges retain their terms and can still be reviewed.
- Code uniqueness survives deletion so old printed/shared codes never acquire a different meaning.

## 4b. Voucher Use Lifecycle

```text
quote preview (no use) → submitted charge: held → payment approved: confirmed
held → payment rejected → corrected request: same held use
held membership purchase → explicit final abandonment: released
```

- Reserve capacity atomically when creating the authoritative charge, not when typing/applying a code. Enforce total and per-customer limits in the same transaction.
- Approval changes held to confirmed exactly once, alongside existing payment approval, reference claiming, and membership effects.
- Rejection alone does not release capacity: the existing workflow allows correction at the original price. Approval after expiry/pause honors the committed reservation.
- Recommend an explicit admin-only abandonment action for unfulfilled membership purchases to release capacity, block replacements, and clear the pending-purchase guard. This is additional scope and requires acceptance before implementation. It must reject already approved charges and race safely with approval.
- Daily attendance has already incurred a charge: never expire/release its discount automatically. Outstanding daily charges retain their reserved use until settlement or a future explicit financial adjustment workflow.
- A released use remains in history and is excluded from held/confirmed capacity. No automatic timer silently reprices submitted transactions.

## 5. Data Model

Conceptual Firestore additions; finalize storage validation and indexes during implementation.

```text
Voucher
  id, normalizedCode, internalName, privateNote?
  status: enabled | paused | archived | deleted
  revision, discountKind: fixed | percent
  fixedMinor? / percentBasisPoints?, maxDiscountMinor?
  allowedChargeKinds[], allowedCategories[], minimumBaseMinor?
  startsAt?, endsAt?, totalUseLimit?, perCustomerUseLimit?
  heldCount, confirmedCount, confirmedDiscountMinor
  createdAt, createdBy, updatedAt, updatedBy

VoucherCodeClaim
  normalizedCode (unique key), voucherId, retiredAt?

VoucherUse (one per voucher/charge)
  id, voucherId, voucherRevision, chargeId, personId
  status: held | confirmed | released
  categorySnapshot, chargeKindSnapshot, codeSnapshot
  baseAmountMinor, discountAmountMinor, netAmountMinor
  reservedAt, confirmedAt?, releasedAt?, releaseReason?

VoucherCustomerUsage (transactional per-voucher/person counter)
  voucherId, personId, heldCount, confirmedCount

Charge (existing, extended)
  baseAmountMinor, discountAmountMinor, voucherSnapshot?, voucherUseId?
  amountMinor remains net payable
  abandonedAt?, abandonedBy?, abandonmentReason? (membership only, if accepted)

PaymentRequest (existing)
  amountMinor remains equal to the linked charge's net payable

AuditEvent (existing)
  voucher management, reservation, confirmation, release evidence
```

**Scalability notes**

- Preserve existing unitRateMinor, categorySnapshot, rateRevision, and quantity semantics. Old charges without discount fields mean base equals amountMinor and discount equals zero; no historical backfill is invented.
- Snapshot all applied voucher terms and amounts. Later edits cannot recalculate an old charge, replacement request, receipt, or collection.
- Keep reservation, counters, charge creation, operation receipt, and audit inside the Firestore transaction. Approval and abandonment also update usage atomically; callbacks must tolerate Firestore retries.
- Use stable customer identity across official/pending profiles. Per-customer limits are an operational rule, not proof of a unique human; the existing phone-entry model cannot guarantee that.
- Version-bound server quotes include person, purchase kind, category, base/rate revision, voucher/revision, net total, and validity. Treat client amounts as assertions to verify, never authoritative prices.
- Never expose private notes, aggregate customer identities, or unrestricted voucher listings through public endpoints. Deny direct client writes to vouchers, claims, uses, and counters.
- Paginate usage/history and add required Firestore indexes. Counters are transactional enforcement data; keep use records for reconciliation and repair.
- Net collections remain compatible with existing reporting. Show gross eligible value and confirmed discounts separately where useful; do not label discounts as received cash or expenses.

## 6. Suggested Build Order

1. **Accept voucher policies and settings design** — resolve the highlighted decisions before schema/contracts and UI behavior are fixed.
2. **Discount rules, contracts, and transaction tests** — establish centavo arithmetic, eligibility, quote validation, capacity races, and historical compatibility.
3. **Admin management and settings layout** — ship consistent pricing controls and voucher creation/editing/history against real protected endpoints.
4. **Daily check-in integration** — reserve once alongside existing charge/attendance creation and preserve repeat-visit behavior.
5. **Shared membership purchase integration** — cover customer and admin-assisted entry, discounted receipt proofs, replacements, and membership approval.
6. **Usage settlement, abandonment if accepted, and reporting** — reconcile held/confirmed counts and expose complete review/history.
7. **End-to-end verification and rollout** — verify rules/indexes, visual layouts, keyboard behavior, production configuration, and financial regressions.

UI work can proceed alongside rule implementation once the contracts are accepted. Do not expose live voucher entry until reservation and approval behavior are complete.

Required focused checks: fixed/percentage rounding and caps; wrong category/kind; unset monthly rates; schedule boundaries in Asia/Manila; last-slot concurrency; per-person concurrency; idempotent retries; two admin revisions; pause/edit after preview versus after submission; same-day daily returns; receipt amount binding; reject/correct without a new use; duplicate approval; abandonment/approval races if included; legacy undiscounted charges; light/dark and narrow-screen layout.

## 7. Open Items / Future Considerations

- **Decision recommended for first release:** fixed PHP and percentage discounts; one code per charge; separate Daily / Renewal / New membership scope; Student/Regular filters; optional schedule/limits; PHP 1 minimum payable.
- **Reservation decision:** accept charge-level held uses and immutable corrections. Decide whether to include explicit membership abandonment now; without it, unresolved submissions retain capacity and should be clearly visible to the admin.
- **Deletion decision:** permanent deletion only before any submission; archive used codes; retain code tombstones and audit history.
- **Identity:** one-per-customer uses the existing stable profile identity; stronger ownership verification would be a separate feature.
- **Deferred:** free sessions/100% discounts, voucher stacking, bulk unique-code campaigns, referral rewards, automatic promotions, package/custom-duration pricing, financial void/refund flows, and retroactive voucher application to an existing daily charge.
- **UI validation:** the proposal defines layouts and states; implementation must still be visually checked in the running application. No frontend changes or migrations have been made by this planning step.
