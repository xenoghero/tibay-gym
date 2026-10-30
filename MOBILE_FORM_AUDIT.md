# Mobile date and numeric input audit

Audited 2026-10-29. Source scan covered every route in `app/` and every input in `components/`, including conditional forms, drawers, sheets and edit dialogs.

| Page / flow | Date or numeric fields | Result |
| --- | --- | --- |
| `/dashboard/people/new`, `/dashboard/people/[id]/edit` | Phone, birth date, membership expiry and join date (membership dates appear when editing a member) | Shared native picker opens from the field body; phone uses `tel` with a numeric keypad; hints and errors linked to their fields. |
| `/dashboard/people/[id]` | New and corrected weight, measurement date | Decimal keypad retained with 0.1 kg steps and existing date bounds; shared picker; add/edit fields stack on small phones. |
| `/dashboard`, `/dashboard/statistics` | Collection period, date, custom start/end; attendance custom start/end | Shared picker in desktop and mobile controls; mobile attendance range has visible From/Through labels and full-width stacked inputs. |
| `/dashboard/audit` | From and Through dates | Shared picker retains date bounds; filters stack below 480px. Identifier fields remain text. |
| `/dashboard/payments` and receipt review in payment history | Reviewed PHP amount, return filing deadline and actual filing date | Decimal keypad retained; retention dates use the shared picker. Payment references remain text because they can contain letters. |
| `/dashboard/settings` → Pricing | Regular/student rates for each term | Decimal keypads retained; shared input minimum touch size and visible keyboard focus. |
| `/dashboard/settings` → Vouchers | Amount/percentage, maximum discount, minimum purchase, start/end timestamps, total/per-customer uses | Decimal or integer keypads retained; shared native date/time picker. Optional limits remain clearable. Codes remain text. |
| `/dashboard/settings` → Payment accounts | Wallet mobile number, bank account number | Wallets request numeric keypads. Bank identifiers permit letters; all account numbers remain strings to preserve leading zeroes. |
| `/dashboard/sms` → Settings | Daily sending time, maximum attempts | Shared time picker; retry count uses a native 1–3 selector, avoiding invalid intermediate numeric values. |
| `/checkin`, `/customer` | Phone lookup and registration | Existing `tel` inputs already request numeric keypads and retain phone length handling. Shared mobile font/touch sizing applies. |
| Membership renewal/conversion, unverified members, people list, Print QR, login, landing and development Firebase check | No additional editable dates or quantities | Inspected. Purchase prices/dates and list counts are derived displays or choices; search, references and identifiers remain text. |

## Shared behavior

`components/ui/form-input.tsx` enhances native inputs without adding wrappers or changing submitted values. Date, local date/time and time fields call `showPicker()` from a click or Alt+Down. Focus alone does not open a picker. Missing or rejected picker APIs leave native editing available; readonly inputs and disabled fieldsets are respected. Native labels, refs, validation, min/max bounds and change handlers remain intact.

`app/globals.css` provides a 44px minimum height, visible keyboard focus for shared controls, and 16px text on narrow screens or coarse pointers, including legacy inline styles. Date controls use the system color scheme. No viewport zoom restriction was added.

## Validation

- All 50 tests in nine focused DOM suites passed. They cover shared picker behavior/fallbacks, bounds and required validation, refs/form values, decimal/phone handling, wallet keyboards, retry choices, reports, audit, pricing/vouchers, receipt review and retention.
- Browser layout check used the actual profile form plus representative shared date/time/number controls in an isolated Vite fixture with synthetic data and mocked persistence/navigation. At widths 320, 390, 768 and 1280px, all 12 inspected inputs stayed inside the viewport with no page overflow and at least 44px height. Mobile sizes had at least 16px text. The 390px screenshot was visually inspected.
- Headless Edge successfully called its real native picker API from the membership expiry field body, dismissed the picker, and updated the controlled date value. The instrumentation counted calls while delegating to the browser's original API.
- `npx tsc --noEmit` and `npm run lint` passed. No live customer records or production settings were changed.

Physical iOS Safari and Android picker/keyboard presentation still need device confirmation. The browser fixture verifies controls and responsive sizing; it is not an authenticated end-to-end walkthrough of every page.
