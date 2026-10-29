# SMS live verification — October 29, 2026

Owner authorized diagnosis and one individual test through the configured Android cloud gateway. No campaign was sent.

- The original requested test was queued with zero attempts. No saved SMS settings existed, so sending defaulted to disabled. Queueing alone does not run the worker.
- Running the sending service temporarily produced HTTP 400. The cloud API's `smsgateway.Message.id` schema permits at most 36 characters; the application supplied its full 64-character SHA-256 storage ID.
- New messages now persist a stable 36-character hash prefix as their provider ID. Storage/deduplication IDs remain unchanged. Existing provider IDs are preserved for reconciliation.
- Added a worker regression test reproducing rejection of oversized IDs and verifying stable IDs through delivery reconciliation. It failed before the fix and passed afterward. All 30 tests across the SMS service, provider, reminders and campaigns passed; TypeScript passed.
- Retained the original HTTP 400 rejection and queued one replacement of the same owner-requested test. The gateway accepted it, and the device progressed through Pending and Processed before Failed.
- The provider reported `Send result: RESULT_ERROR_GENERIC_FAILURE (Generic failure cause)`. This does not establish a specific SIM, credit, radio or carrier cause. That linked message was not delivered.
- Sending and policy settings were restored to their original disabled/unconfirmed values after each diagnostic run. Credentials remain only in the Git-ignored local environment.

## Plain-text delivery confirmed

The owner subsequently reported successful ordinary SMS delivery and supplied a photo showing linked messages marked Not sent. Sent one additional owner-authorized test through the same application queue/worker and configured device, using only `Tibay Gym: This is your requested SMS delivery test.` without a link. The gateway reported Delivered and the worker saved `status: delivered`, `providerState: Delivered`, with one sending attempt. The owner also confirmed receiving this test on the actual phone. Original disabled/unconfirmed sending settings were restored afterward. No blast was sent.

This verifies individual plain-text sending through the integration. The earlier failed message included a localhost URL; its failure reason remains generic, so carrier URL filtering is a hypothesis rather than a proven cause. A localhost URL would not open the gym site from a recipient's phone in any event. Two-person campaign delivery, client-device configuration, production activation and unattended schedules remain unverified.

Next: review and authorize a short plain-text campaign to the two consenting test recipients. Configure the eventual deployed customer URL separately before including links in future messages.

The owner chose to retain Android SMS Gateway for now after discussing business SMS alternatives. Continue with plain-text messages; no business SMS provider was configured.

Provider schema checked: <https://api.sms-gate.app/docs/doc.json>.
