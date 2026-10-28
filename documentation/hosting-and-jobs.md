# Hosting and scheduled maintenance

## Current state — October 28, 2026

Receipt database readiness passes. No live Next.js URL, linked hosting project or scheduler has been configured in this workspace. Existing firebase.json configures Firestore rules/indexes only; it does not deploy the application. The owner explicitly deferred hosting and paid resources on October 28 to focus on functional local features. Hosting and unattended scheduling remain incomplete and deferred; local admin actions continue to run the protected jobs while the app is running.

The saved Firestore indexes were deployed separately on October 28 to resolve the live report-query prerequisite, and queries were verified after index building completed. Firestore rules and app hosting were not deployed. Local route/service receipt checks against live backends passed; see receipt-gcash-live-verification.md.

Both maintenance routes now accept either the private CRON_SECRET or the existing verified admin session token. Missing, short or wrong scheduled credentials fall back to normal admin verification; no work runs without authorization. Secret comparisons use byte lengths and a timing-safe comparison. The credential grants access only to these maintenance endpoints, not general admin mutations.

| Job | Protected request | Work |
|---|---|---|
| Receipt recovery/OCR | POST /api/receipts/worker | Scan 25 receipt intents for approved retention/hold policy, durable link/correction/retry recovery, one leased OCR job, expired unlinked receipt cleanup |
| Photo cleanup | POST /api/images/cleanup | Inspect at most 100 expired upload jobs and remove objects no longer linked to their profile; active linked photos remain |

Send Authorization: Bearer followed by the configured CRON_SECRET. Keep it in server/scheduler secret storage, not URLs, Git, browser configuration or job logs. Both routes return no-store responses and declare a 120-second deployment budget. The receipt worker uses a separate five-minute claim lease and a 45-second OCR timeout. Requests may be retried; record failures and inspect queue age rather than assuming a schedule entry proves processing.

## Deployment requirements

- Use a Node.js 22 server runtime with the app's dynamic API routes. Static-only hosting cannot run this application.
- Preserve sharp native binaries, Node worker threads, tesseract.js, tesseract.js-core and bundled English language data. next.config.ts already traces the OCR dependencies for the worker route. Validate extraction on the actual host.
- Support the current 5 MB image request limit end to end, or explicitly adapt all matching server/client limits before rollout. Vercel Functions currently limit request/response payloads to 4.5 MB, so an unchanged Vercel deployment would not accept the top end of this app's upload range. [Vercel function limits](https://vercel.com/docs/functions/limitations).
- Configure matching browser/server Firebase project values, server credentials and allowed admin UID, private Supabase URL/secret, canonical HTTPS NEXT_PUBLIC_APP_URL and a random private CRON_SECRET of at least 20 characters. NEXT_PUBLIC values are build-time browser configuration; privileged values stay server-only. Keep isolated/emulator flags unset in production.
- Configure the deployed domain for Firebase Authentication. Check customer Secure cookies and same-origin requests on the final HTTPS origin.
- Set trusted client-IP handling only after verifying which header the actual host overwrites. Public rate limiting is best effort per process; deployment does not establish distributed abuse protection.

## Scheduler selection

Use a server-side scheduler capable of authenticated HTTP POST with a request deadline of at least 120 seconds. A reasonable starting cadence is receipt work every minute and photo cleanup once daily; confirm it when choosing the host and monitor backlog/usage. Each receipt call claims one OCR job, so the nominal throughput of a one-minute schedule is at most 60 jobs/hour before failures or overlaps. Cleanup enforces the October 28 approved policy in audit-and-retention.md. Locally, Payment review's Run retention cleanup button invokes both jobs. No unattended execution is configured.

Do not add a provider schedule that silently calls an unsupported method. For example, Vercel's built-in scheduler calls GET, while these routes deliberately expose POST; selecting that scheduler requires a separately protected integration. [Vercel cron behavior](https://vercel.com/docs/cron-jobs). An external POST scheduler can use the existing endpoints without adding GET mutations.

Firebase App Hosting is another potential destination, but it requires the pay-as-you-go Blaze plan. Billing/account choice and provider-specific setup remain with the owner; no billing changes or cloud resources were created. [Firebase App Hosting costs](https://firebase.google.com/docs/app-hosting/costs).

## Rollout and proof

1. Confirm hosting account/project, billing preference and canonical domain. Configure build/runtime secrets privately and deploy the matching application. Avoid connecting previews to live financial writes.
2. Check sign-in, customer access, server Firebase identity and live receipt readiness on that deployment. Confirm Node/OCR assets and permitted request sizes.
3. Coordinate the matching Firestore rules/index rollout after the app is ready. Verify required indexes and the synchronized admin identity; do not enforce revised browser-write rules against an older app.
4. Add the two protected schedules using the same server secret, retain status/log evidence and verify a successful invocation from the scheduler. Use controlled synthetic evidence to test OCR and recovery separately from real payments.
5. Check failed/expired job recovery, absence of unauthorized execution, queue age and cleanup progress. Then record the actual provider, URL, cadence and observed results in OWNER-FOLLOWUPS.md and the phase log.

Local preparation tests cover exact/wrong/missing/short/non-ASCII credentials, the interactive-admin fallback, authorization before both jobs and uncached responses. These are not evidence of a deployed schedule.
