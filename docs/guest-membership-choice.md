# Guest membership choice

Status: implemented from the functional design confirmed November 3, 2026 and the approved black-and-yellow mobile-first Membership spotlight preview.

## Confirmed decisions — November 3, 2026

- Show the choice after identifying or registering a guest, before submitting daily payment or attendance.
- Show it to first-time and returning guests starting a chargeable check-in.
- Highlight “Want to be a new member?” as the primary option; offer “Daily session only” as the alternative.
- Agreed prices: Regular PHP 700/month or PHP 70/session; Student PHP 600/month or PHP 60/session.
- Monthly membership and daily sessions are alternatives. Covered membership visits carry no additional daily fee.
- Show the customer's selected rate category prominently.
- The membership action reuses the existing customer membership purchase flow and carries over the guest's identity.
- Guests awaiting profile verification see guidance to ask the front desk to verify their account before starting membership; daily sessions remain available.
- A pending membership purchase does not permit membership-covered attendance. Show its pending status and direct the guest to the front desk for approval, without automatically creating a daily charge.
- Display configured Admin Settings rates rather than hardcoded marketing prices. If monthly pricing is unavailable, keep daily sessions available and direct membership inquiries to the front desk.

## Existing constraints

- Current guest check-in proceeds from phone lookup to daily payment, then attendance confirmation.
- Public account creation is separate and can require administrator profile verification.
- The existing customer membership purchase flow accepts verified official profiles; payment approval activates membership.
- Rates are configurable. Monthly defaults are unset; operations documentation records owner-approved PHP 600/700 monthly rates saved October 28, 2026. Live settings have not been checked during this interview.

## Agreed flow

1. Identify or register the guest using the existing flow.
2. Before a chargeable check-in, show the highlighted monthly membership choice and the daily-session alternative, using the guest's Student or Regular category and configured prices.
3. Choosing daily continues the existing daily payment and attendance flow.
4. Choosing membership with a verified profile opens the existing purchase flow with the guest's identity carried over.
5. Choosing membership with an unverified profile explains the front-desk verification requirement; daily remains available.
6. Membership payment submission follows the existing review process. Until approval, display pending status and front-desk guidance without automatically submitting daily payment or attendance.
7. After membership activation, the existing covered-member check-in flow applies.

## Scope

This introduces a choice for guests starting chargeable check-ins. Existing member renewal, checkout, already-recorded visits, membership purchase options, payment methods, vouchers, and financial approval rules retain their existing behavior.

The public welcome, registration, daily payment, verification, and attendance confirmation screens use the approved dark design. Per the user's follow-up, the welcome slogan block is removed and the welcome card and promotional banner share a centered, matching-width frame. The first welcome page retains the existing configured promotional banner carousel, including rotation, accessibility, and failure/empty behavior; no new promotional artwork or offers are published. The existing customer purchase flow uses the same dark palette at `/members`, while `/customer` keeps its existing appearance.

## Implementation

- Lookup returns only the guest's rate category plus configured public monthly/daily prices alongside its existing allowlisted response. Existing lookup rules decide whether a chargeable visit needs payment; the choice does not intercept covered members, checkout, or already-charged same-day visits.
- Choosing daily reveals the existing payment form. Per the user's follow-up, choosing membership creates the normal server session from the already-entered phone number and redirects to `/members#renew` payment setup. The phone number is not added to a URL or browser storage. The destination resumes the cookie session; direct visits without a session allow normal phone-number access.
- The handoff rechecks profile verification through the server session before enabling purchases. Submission retains the existing quote, receipt, voucher, duplicate-request, and approval handling.
- Existing pending membership requests are read from the existing membership purchase guard, independently of daily-payment history pagination. The check-in handoff displays that request and front-desk guidance instead of opening another purchase form. Daily pending payments do not imply a pending membership.
- Unverified guests are guided to front-desk verification at `/members`, with a link back to daily check-in. Returning from membership starts a fresh attendance lookup so a subsequent check-in refreshes current membership standing instead of submitting a stale daily payment.
- Registration itself still records neither payment nor attendance. “Check in now” looks up the newly created profile and offers the session choice before payment.
- No pricing settings, database schema, payment approvals, production promotional content, or real customer records are changed by this implementation.

## Verification targets

- New and returning guests see the choice before any daily charge or attendance submission.
- Student and Regular guests see their configured monthly and daily rates.
- Daily selection retains the existing payment, voucher, retry, and attendance behavior.
- Membership selection carries over the verified guest's identity and preserves profile/history.
- Unverified guests receive verification guidance and can still choose daily.
- Pending membership does not activate coverage or automatically incur a daily charge.
- Unavailable monthly pricing produces front-desk guidance while daily remains usable.
- Existing members, checkout, and already-recorded attendance retain their existing behavior.

## Validation — November 3, 2026

- Full Vitest suite: 109 files, 723 tests passed.
- Production build passed, including TypeScript and the new `/members` route.
- ESLint passed. After the final centering and session-loading adjustment, the customer-access regression tests (16 tests) and production build passed again.
- Browser checks used mocked API responses: welcome promotions, phone lookup, configured Student/Regular prices, daily payment and confirmation, `/members#renew` identity handoff, existing pending membership, registration and verification guidance, and usable browser Back navigation.
- Reflow checked at 320, 390, 768, and 1440 pixels. The welcome slogan is absent; the welcome card and banner share the centered frame. The phone check-in card and other public check-in steps also center vertically when they fit, while longer forms remain scrollable.
- Standards and spec reviews completed with no outstanding actionable findings after addressing pending-membership handling.
