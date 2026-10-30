# SMS verification without the Android phone

October 29, 2026. Requested while the owner’s phone/gateway was unavailable.

Run the repeatable check with:

```powershell
npm run test:sms:offline
```

**Result: 72 tests passed across 10 files.** The run includes the existing SMS rules, reminder rules, worker/service, adapter, campaigns, protected API, and SMS interface tests, plus nine new HTTP integration cases in `tests/sms-gateway.integration.test.ts`.

The integration test starts a temporary HTTP server on `127.0.0.1` with an automatically allocated port. It uses the real application queue, sending worker, gateway HTTP adapter, reminder scanner, and campaign dispatch code. Firebase is replaced with the transactional in-memory test store. Gateway credentials, customer profiles and destinations are synthetic; a fetch guard rejects non-loopback destinations. Cleanup closes the server and restores the test environment after each case.

| Scenario | Observed software result |
|---|---|
| Queue while disabled | No HTTP send; worker reports disabled |
| Simulated Pending → Sent → Delivered | Separate accepted/sent/delivered states; one POST, stable provider ID for subsequent status GETs |
| Gateway-compatible payload | Provider ID at most 36 characters, expected text/recipient, delivery report request and TTL |
| Connection lost during send | Uncertain outcome; subsequent missing lookups never cause a blind resend |
| Gateway eventually reports failure | Terminal failed outcome, without a duplicate send |
| Explicit HTTP 429 rejection | Two/four-minute backoff; at most three attempts; no early retry |
| HTTP 401/403/422 | Terminal failure, not claimed delivery |
| Consent removed after queueing | Cancelled before any HTTP submission |
| Campaign audience changes | Only still-eligible recipients submitted; counts distinguish accepted from cancelled |
| Renewal/new attendance after reminder queueing | Obsolete expiry/inactivity messages cancelled before submission |

No real SMS was sent, no carrier/gateway account was contacted, and no live settings, permissions, customer records, or messages were changed. The simulated Delivered response verifies the application's handling of that response; it is not evidence of handset receipt, SIM readiness, carrier acceptance, or physical delivery.

The prior live-test history remains separately recorded in `sms-live-verification.md`; it does not establish the phone’s current condition. Current hardware sending/delivery can be verified once the phone is operational and a recipient-specific live test is authorized.
