# Phase 10 — Expiry and Inactivity SMS

**Status:** local implementation complete; live scheduling/provider checks explicitly deferred
**Task list:** documentation/TASKLIST.md
**Task list items covered:**

- [x] **Build:** Schedule expiry reminders at 7, 5, and 1 day before current expiry, once per member/reminder point/expiry cycle.
- [x] **Build:** Recheck the latest expiry immediately before sending; cancel obsolete queued work after renewal and do not batch missed reminder points.
- [x] **Build:** Detect members inactive for more than 10 days using last attendance and the agreed handling for members with no visits.
- [x] **Build:** Deduplicate inactivity episodes and apply the agreed repeat cadence; cancel obsolete follow-ups after a new visit.
- [x] **Build:** Apply contact eligibility, permission, opt-out rules, configured sending time, and audit coverage to automatic messages.
- [x] **Verify:** Check 7/5/1-day boundaries, late registration, renewal before sending, exactly 10 versus more than 10 inactive days, a returning member, and repeated scheduled runs.
- [ ] **Verify:** Validate scheduled operation and real provider responses when configured; preserve the Phase 9 activation gate.

---

## Log

### 2026-10-28
- Verified Phase 9 publication: 05b105d621bb6462592523d739895666ea9da41e matches fetched origin/main; ancestor check passed. Its 444 tests, lint and production build passed. Owner explicitly deferred gateway activation and requested continuing local work.
- Added bounded rotating 50-profile reminder scans, protected maintenance POST endpoint, authenticated paginated read-only preview, and local admin scan/queue controls. No unattended schedule was configured.
- Expiry keys include person, exact expiry cycle and 7/5/1-day point. Only today's point is considered, using Philippine calendar dates and the configured sending time. Missing past points are never queued in a catch-up batch.
- Inactivity requires a recorded last visit more than ten elapsed days ago; no-visit profiles are excluded. The last-visit timestamp identifies a single episode, with one message per episode. A new visit permits a future new episode.
- The sending claim re-reads membership expiry, last visit, contact permission/opt-out, number and settings in its transaction. Renewal/attendance changes cancel obsolete queued messages. A later configured daily time pauses rather than prematurely cancelling otherwise valid work. Already accepted external messages cannot be retracted.
- Audited reminder creation/cancellation. Shared sending remains disabled by default; preview neither queues nor sends. Tests cover calendar/time boundaries, expired offsets, concurrent/repeated runs, preview/consent, renewal/return cancellation and new episodes.
- Final repository checks and publication evidence follow after command completion; actual provider responses and production scheduling remain unverified at the owner's request.

**Suggested commit message:** `feat(phase-10): add renewal-aware expiry and inactivity reminders`

- Final verification: npm test passed 74 files / 460 tests; npm run lint passed. A test fixture type assertion failed the first production type-check; narrowed the pure reminder function's input to its actual required fields and removed the assertion. Targeted reminder/template tests (15) and final npm run build (including TypeScript) passed. Final targeted lint passed; publication pending in this commit.

**Publication verified:** 5681bca6a5dff93841f3a77b18fa5ee3fd8efc9e (feat(phase-10): add renewal-aware expiry and inactivity reminders) was pushed to origin/main and verified by fetched hash and ancestry before Phase 11. Actual provider and unattended schedules remain deferred.
