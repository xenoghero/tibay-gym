# Phase 03 — Registration Additions and Customer Access

**Status:** complete
**Task list:** documentation/TASKLIST.md
**Publication:** verified on origin/main at bd72bc8029e73c3bef4999febe536b36df096655

**Task list items covered:**

- [x] **Build:** Add Create Account / Check In entry choices using existing phone lookup and visitor approval behavior.
- [x] **Build:** Require Student / Regular category on public registration and admin-created profiles; support admin completion of existing missing categories.
- [x] **Build:** Add the required lead-source question with Ads, Facebook Page, Google Search, Friends, Physical Signage, and Others; require details for Others.
- [x] **Build:** Add optional profile photo upload, private image storage, authorized image access, profile display, and failed-upload/orphan cleanup.
- [x] **Build:** Preserve pending-profile identity, category, lead source, and picture through approval without losing visits or later financial links.
- [x] **Build:** Add phone-number customer entry without OTP and a restricted server-issued session for renewal submissions and limited payment status.
- [x] **Build:** Bind customer actions to that session, limit returned information, throttle access, and prevent access to other customer IDs or admin operations.
- [x] **Verify:** Check duplicate registration, pending approval, optional photo failures, required fields, session expiry, and customer-data boundaries.

## Log

### 2026-10-25
- Added Create Account / Check In entry choices, required category and lead source, Others details validation, and admin classification of legacy profiles without fabricated history.
- Added restricted 30-minute customer sessions with hashed tokens, private cookies, same-origin checks, throttling and minimal membership/payment projections bound to the session customer.
- Added optional private profile photos after registration, server decoding/metadata stripping/resizing, image authorization, admin display, stable retry jobs and bounded orphan cleanup. Photo failures preserve saved registration/visits.
- Preserved pending identity/category/source/photo through approval and retained existing visits/guards.
- Ran node scripts/private-images-setup.mjs successfully: private profile-photos bucket created/verified; no public policies or objects. Added explicit sharp dependency (already installed through Next).
- Verification: npm test passed (41 files, 322 tests), npm run lint and npm run build passed; npx tsc --noEmit passed. Includes required fields, approval preservation, session expiry, ID/cursor boundaries, bad images, interrupted uploads and orphan cleanup.
- Files: registration/customer/photo components and routes, shared registration validator, server sessions/images, attendance/admin profile integration, setup script, tests, package manifest/lock and reporting index.
- Production scheduling of cleanup, mobile visual review and production app/rules rollout remain Phase 8 checks; see documentation/customer-access-and-photos.md. Active-photo retention period remains owner-dependent; no automatic purge was invented.

**Suggested commit message:** `feat(phase-03): add registration details and private customer access`
