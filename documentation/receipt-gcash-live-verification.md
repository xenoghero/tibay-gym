# Receipt / GCash verification — October 28, 2026

**Result: passed for the local application's route handlers/services against live Firebase Auth, Firestore, Supabase metadata and private Storage.** Tesseract ran locally on evidence downloaded from the private bucket. This does not claim a deployed host, full phone/browser walkthrough, a real GCash transfer or verification against a real customer's receipt.

Owner authorized receipt/GCash testing. All evidence was generated with prominent SYNTHETIC TEST / NO MONEY TRANSFERRED / NOT A PAYMENT RECEIPT labels. Profiles used synthetic names and non-routable 000-prefixed phone fixtures. No real customer existed when the run began. Existing admin identity and allowed-UID synchronization were checked; real Firebase ID tokens for that existing account were used in protected route requests. Tokens and credentials stayed in process memory and were not recorded.

## Checks performed

| Check | Observed result |
|---|---|
| Private schema and bucket | Readiness true; metadata accessible to the privileged backend; bucket remains private |
| Actual application authorization | Owner and verified admin image requests returned 200; foreign customer returned 403; anonymous request and customer request for admin OCR/review data returned 401; direct public object URL denied |
| Image validation | Unsupported PDF request returned 415 before storage |
| Daily GCash attendance | Valid bound receipt allowed check-in with payment pending; OCR and later daily confirmation did not activate membership |
| OCR extraction | Real Tesseract read stored synthetic daily/monthly images and extracted expected amounts and references, preserving leading zeros; OCR alone left payments pending |
| Interrupted upload | One scoped Storage request was deliberately made to return 503 after metadata creation. Retry recovered the same receipt/object; changing the image under the same operation returned 409 |
| Interrupted linking | One test-receipt metadata PATCH was deliberately made to fail. The linked Firestore intent remained recoverable; reconciliation repaired the live SQL link. Purchase response replay reused the same charge/request |
| Amount mismatch and correction | Reviewed mismatch blocked approval. A deliberately interrupted correction sync retained its audited Firestore review/outbox; recovery updated SQL and removed the outbox |
| Unreadable evidence | OCR produced needs_review; payment and membership stayed unapproved |
| Duplicate reference | A reference already claimed by the Student purchase blocked the Regular approval with reference-already-used |
| Rejection and replacement | Rejection left membership unchanged; a replacement retained the original charge rather than creating another sale |
| Expired lease / concurrent workers | A synthetic expired processing lease was reclaimed; two competing workers claimed the test receipt only once and incremented its attempt count correctly |
| Concurrent/repeated approval | Repeated approval and two concurrent approval requests succeeded idempotently; Regular activation produced one status change and one applied coverage |
| Customer status / reporting | Restricted status exposed the approved result without raw text/object paths. Daily PHP 60 + Student PHP 600 + Regular PHP 700 reconciled to three confirmations totaling PHP 1,360 before teardown |
| Orphan cleanup | An expired unlinked test upload was removed from Storage, SQL metadata and Firestore intent records |
| Worker failure / bounded retries | A separate synthetic metadata row pointed to a deliberately missing object. Live workers recorded failed OCR for attempts 1–3, then stopped claiming it. No charges or payment requests were created by this test |
| Public pre-registration receipt | Receipt upload before profile creation bound to the predicted pending-visitor ID. Scan created one pending visit/charge; session could view its receipt but could not request membership before verification. Admin verification preserved ID/history/receipt. Daily rejection retained attendance and expected charge, with zero confirmed money |
| Deletion privacy / retention | Ordinary profile deletion removed receipt objects/raw extraction while retaining three minimal test charges before disposable-fixture teardown |

The primary run passed 12 grouped checkpoints, followed by separate missing-artifact and public-registration checks. Faults were injected only into individual known synthetic operations; no service, key, policy or general network access was disabled. Existing automated tests continue to cover the broader cash, stale-membership and input permutations.

## Index prerequisite resolved

The first source-report query returned Firestore FAILED_PRECONDITION for a missing index. Ran `firebase deploy --only firestore:indexes --project tibay-gym --non-interactive`; the saved indexes deployed successfully. Waited for building to finish, then verified source-report queries. This deployed indexes only, not Firestore rules or app hosting. The separate matching rules/hosting rollout remains deferred.

## Cleanup proof

Temporary test IDs/operations were tracked so cleanup was restricted to these disposable fixtures. The initial empty customer/financial baseline was required. Ordinary deletion retention was checked first, then only synthetic financial/audit/operation fixtures were purged; this test teardown does not change the ordinary customer-retention policy.

Final live inspection found:

- Zero official/pending profiles, charges, payment requests, attendance logs, customer sessions, receipt intents/reviews or correction/retry outboxes.
- Zero Supabase receipt metadata rows; private test files and extraction text removed.
- Expected and confirmed report totals both zero.
- Original pricing audit retained; revision 1 and Student daily/monthly PHP 60 / PHP 600, Regular PHP 70 / PHP 700 unchanged.
- Transaction sequence was deliberately not rewound; disposable tests consumed numbers, leaving safe sequence gaps before the first real transaction. Infrastructure auth-throttle records retain their normal expiry.

Temporary execution files were removed after verification. No application code or migration changed; a new build/test-suite rerun was unnecessary for these live operational checks. Hosting/runtime scheduling, full authenticated phone UI and RFID hardware remain separate follow-ups. An anonymized real GCash screenshot can optionally assess layout-specific OCR accuracy later; none was required for the functional tests.
