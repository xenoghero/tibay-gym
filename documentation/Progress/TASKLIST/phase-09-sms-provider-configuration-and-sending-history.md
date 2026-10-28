# Phase 09 — SMS Provider Configuration and Sending History

**Status:** local implementation complete; gateway setup and live delivery explicitly deferred by owner
**Task list:** documentation/TASKLIST.md
**Task list items covered:**

- [ ] **Resolve:** Select the provider, sender identity, funding, daily sending time, template text, retry limits, and contact permission/opt-out approach before live activation.
- [x] **Build:** Add SMS settings and credentials handling, initially disabled; add SMS-specific customer permission/opt-out fields and the agreed collection interface.
- [x] **Build:** Add SmsCampaign, SmsMessage, and SmsAttempt contracts/storage, recipient eligibility, message snapshots, and deduplication keys.
- [x] **Build:** Add the provider adapter, retryable sending queue, worker claims, per-attempt responses, provider IDs, and uncertain-send reconciliation.
- [x] **Build:** Show sending history, failures, provider acceptance, and delivery only when supported by provider evidence.
- [x] **Build:** Add an explicit admin test-send action, private provider configuration access, and audit coverage for SMS settings/actions.
- [ ] **Verify:** Check disabled/unconfigured behavior, eligibility exclusion, duplicate worker claims, failed requests, ambiguous responses, and provider test delivery when configured.
- [x] **Gate:** Keep live SMS disabled until the agreed provider account and required setup are ready; leave provider-dependent checks unfinished rather than reporting simulated sends as live success.

---

## Log

### 2026-10-28
- Owner selected Android SMS Gateway and authorized remaining local work while carrying hosting, schedules and RFID checks forward as deferred. The full production phone walkthrough remains an explicit follow-up; no fabricated verification.
- Added private server-only gateway settings and JWT/Basic adapter, disabled defaults, revision-checked audited admin consent/opt-out, snapshotted test queue, transactional claims, bounded rate-limit retries, status lookup and reconciliation. No real texts sent or live configuration changed.
- Added admin SMS operations on desktop/mobile navigation with settings/templates, paginated contacts/history, requested test queue, worker action and attempt evidence. New collections inherit existing default-deny browser rules.
- Removed private SMS contacts/messages/attempts during ordinary profile deletion, retaining minimal audit outcomes. Attempts never store raw response bodies; audit excludes destinations, templates and credentials.
- Proposed defaults pending owner confirmation: 09:00 Asia/Manila, up to three rate-limit-rejection attempts, admin-recorded permission and opt-out, editable templates. Sender is the funded SIM number; actual device/account/funding and delivery remain unverified.
- Verification so far: npm test passed 71 files / 441 tests; npm run lint passed; npx tsc --noEmit passed before the added tests. Production build in progress. Tests cover disabled/unconfigured behavior, authorization, private uncached reads, concurrency, duplicate operations, phone changes/deletion/opt-outs, explicit retry exhaustion, lost responses/expired leases and provider request/status parsing.
- Publication pending review and final checks. Campaign contract completion and activation policy review remain within this phase; later phases have not begun.

**Suggested commit message:** `feat(phase-09): integrate Android SMS Gateway and private sending history`

### 2026-10-28 — approved defaults and activation deferral
- Owner approved 09:00 Philippine sending time, up to three attempts only for explicit rate-limit rejections, editable default templates, admin-recorded consent/opt-out, one inactivity message per visit episode, and excluding members without visits. Owner subsequently confirmed the phone/gateway is not configured and explicitly requested proceeding with other implementation. These live-only checks remain open while local Phases 10–11 may proceed.
- Extended deletion tests with SMS contacts/messages/attempts, added UI disabled/empty/error-retry tests, and expired stale queued tests after 24 hours to prevent activation backlogs. In-flight attempts are recorded before the external request so a crash retains attempt evidence. Added campaign storage contract for the later composition flow.
- Final checks and publication evidence follow after commands finish; no real sends were performed.

**Suggested commit message:** `feat(phase-09): integrate Android SMS Gateway and private sending history`

- Final verification: npm test passed 72 files / 444 tests; npm run lint passed; npm run build passed including TypeScript. git diff --check passed. Gateway setup and live delivery remain explicitly deferred; publication pending in this commit.

**Publication verified:** 05b105d621bb6462592523d739895666ea9da41e (feat(phase-09): integrate Android SMS Gateway and private sending history) was pushed to origin/main and verified by fetched hash and ancestry before Phase 10. Live activation remains deferred.
