# Android SMS Gateway operations

Provider selected by the owner on October 28, 2026: [capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway).

## Admin screen and guided journeys

The SMS workspace opens on **Messages**, with two starting actions: **Send an announcement** and **Review due reminders**. **History** contains announcements, saved drafts and individual delivery records; **Contacts** manages permission. **Settings** is a secondary header action.

Announcements follow **Choose recipients → Write message → Review → Queue → Process → Results**. Search and load more contacts directly in the recipient picker; selection and message text survive moving backward or switching tabs during the session. Only eligible contacts are selectable, with exclusions explained separately. Preview still saves the reviewed draft and requires explicit confirmation before queueing. Saved drafts reopen from History for review, subject to the existing 30-minute expiry.

After queueing, use **Process queued messages** to explicitly run the existing worker, then **View delivery progress** to open the announcement's results. Processing handles the shared queue, in bounded batches; repeat as needed. Queueing alone never sends. Reminder checks show eligible counts and saved templates; **Queue next reminder batch** still processes the next 50 profiles, which may differ from the preview. No automatic schedule was added.

History loads announcements when opened, displays Philippine dates and clear delivery labels, and keeps provider attempts under **Technical details**. Recent results and summary counts cover loaded records only; history pagination retains stable ID order even though loaded messages display newest first. Mobile uses one composition stage at a time with a sticky selection count and action bar.

## Local setup and activation

1. Install SMS Gateway on the Android phone, grant its required SMS permissions, and use a funded SIM/appropriate carrier plan. The sender is that SIM's phone number; this adapter does not configure an alphanumeric sender.
2. Select local mode for an app server on the same reachable network, or cloud/private mode for a remotely reachable gateway. Set server-only `SMS_GATEWAY_URL` in `.env.local`. Local example: `http://192.168.1.10:8080`; cloud example: `https://api.sms-gate.app/3rdparty/v1`. Include the API prefix in cloud/private URLs. Restart Next.js after changes. Never expose a local plain-HTTP endpoint to the internet.
3. Prefer `SMS_GATEWAY_TOKEN` with sending/status scopes where supported. For the local app's Basic authentication, set `SMS_GATEWAY_USERNAME` and `SMS_GATEWAY_PASSWORD` instead. `SMS_GATEWAY_DEVICE_ID` optionally selects a particular cloud device. These values are never saved by browser forms, returned by the admin API, or included in audit events. A configured flag indicates syntactic readiness, not a successful connection.
4. Open Dashboard → SMS operations. Review the owner-approved defaults (October 28): 09:00 Asia/Manila, supplied editable templates, maximum three attempts after explicit rate-limit rejection, admin-recorded consent/opt-out, one inactivity message per visit episode, and no inactivity messages for members without visits. Record the customer's explicit permission for gym reminders and messages before queueing. Existing/pending profiles have no inferred permission. Phone changes require permission to be recorded again.
5. Confirm the sending SIM, funding, templates, permission collection and opt-out procedure using the activation checkbox; then enable sending. No phone, SIM, account, or credit was configured by this implementation. The checkbox is the admin's operational attestation, not tool-verified readiness.
6. Select a consenting customer who requested a test. Queue a test, then explicitly run the sending worker. Review attempts/history and confirm receipt on the actual phone. Acceptance alone does not establish delivery. Disable sending again until readiness is approved. Do not use customer audiences for test blasts.

## Consent and opt-out

An admin asks whether the customer agrees to receive Tibay Gym reminders and gym messages at the displayed number, then uses **Record customer's permission**. Use **Opt out** immediately when requested. Templates explain that the customer can ask the gym admin to stop messages; inbound STOP processing and two-way SMS are outside scope. A permission update is revision checked and audited with the acting admin; it never changes membership. Official profiles only are eligible; deleted/deleting profiles, invalid Philippine mobile numbers, changed numbers, missing permission and opt-outs are excluded before sending.

## Queue and recovery

The admin API requires the existing verified admin identity; the worker POST endpoint `/api/sms/worker` supports that identity or the existing private maintenance credential. It is ready for later scheduling; no host or schedule was created. Use **Process queued messages** locally. Each run rotates through at most ten history rows, including provider-status reconciliation. Larger histories require more runs; a short run does not imply the whole queue is drained.

Messages use stable SHA-256 IDs and one recipient per gateway submission. Claims use Firestore transactions with 60-second leases; requests time out after 12 seconds and do not follow redirects. The worker stores only response codes, allowlisted state names and fixed outcome codes, not raw provider bodies. Safe explicit HTTP 429 rejections retry with exponential backoff (2 then 4 minutes) up to the configured maximum. Validation/auth rejections are terminal; HTTP 5xx, conflicts, malformed responses, transport errors and expired in-flight claims remain uncertain and are looked up by the same ID. Even a lookup returning 404 never triggers a blind resend. Check the Android gateway/outbound log and recipient when a message remains indeterminate; the application intentionally has no force-resend action.

Pending/Processed gateway states mean accepted, Sent means the gateway reported transmission, and Delivered requires an actual Delivered response with delivery reports requested. Provider terminal Failed/Cancelled states are retained. Opting out cannot retract a message already submitted to the gateway. Disabling sending pauses both submissions and status polling. History is paginated in stable message-ID order; attempts are bounded to 100 rows per selected message.

Private contacts, message destinations/text and attempts are removed by ordinary profile deletion. Minimal SMS audit events retain IDs and outcomes without phone numbers or message content. New SMS collections inherit Firestore's existing default browser deny; all access goes through authorized server APIs.

## Expiry and inactivity reminders

Use **Check due reminders** and **Check more profiles** to inspect eligible counts without queueing, including while disabled. **Queue next reminder batch** processes the next 50 profiles when sending is enabled and configured; repeat to cover the roster, then run the sending worker. The protected `POST /api/sms/reminders` endpoint supports future scheduling with the existing maintenance credential. No live schedule exists. Future hosting should invoke scans repeatedly after the configured daily Philippine time to cover the entire roster and run the worker frequently enough to drain it; both endpoints rotate their cursors and safely deduplicate repeated runs.

Expiry reminders use today's 7/5/1-day difference from the latest Philippine expiry date and never catch up missed points. Each expiry timestamp and offset forms its own key. Inactivity is strictly more than ten elapsed days since recorded attendance, once per last-visit episode; no-visit members are excluded. A new visit resets the episode. Immediately before a submission, the worker cancels obsolete reminders after renewal/attendance changes and rechecks contact eligibility. Expiry work that reaches another date is cancelled. Templates are snapshotted at queueing, with `{expiry}` and `{days}` supported only in the expiry template. Reminder checks do not depend on a hosted scheduler to be used locally.

## Existing operations and deferred checks

Collection rates, payments/approvals, OCR review/recovery, customer access, reports and audit guidance remain in `NON-SMS-OPERATIONS.md`, `purchases-and-review.md`, `receipts-and-ocr.md` and `audit-and-retention.md`. Their behavior is independent of SMS configuration. Hosting, unattended schedules, real RFID testing and the full authenticated production phone walkthrough remain deferred. Real SMS acceptance/delivery, SIM funding, device availability and carrier limits remain unverified until the owner supplies a working gateway.

## Text blasts and campaign recovery

1. Record customer permission in SMS operations and load the desired customer pages. Only consenting, non-opted-out profiles whose current number matches the recorded permission appear in the selection list.
2. Write a message of at most 480 characters and select up to 100 recipients. Use multiple separately reviewed campaigns for larger audiences; this bound keeps dispatch within one Firestore transaction. Do not select the same people in multiple campaigns for the same announcement.
3. **Review announcement** saves a draft with the exact text, eligible customer IDs, and fingerprints of the reviewed phone/consent revisions. Duplicate numbers are collapsed. Review the exact message and recipient count; excluded people are counted. No SMS is queued or sent by previewing.
4. Tick the explicit review checkbox and **Queue messages** within 30 minutes. Any edits require a fresh preview. Dispatch atomically rechecks the audience and creates one deterministic message per remaining customer. Opt-outs/changed numbers/changed consent revisions are cancelled; deleted profiles get no new private records. Repeated dispatch of the same campaign is safe.
5. Run the sending worker only when live setup is ready and sending is enabled. Queueing a campaign does not itself contact the gateway. Disabled settings prevent sending. Unsent messages expire after 24 hours, preventing an old campaign from becoming an activation backlog.
6. **Refresh announcements**, **View details**, and **Refresh delivery progress** show derived counts and per-recipient outcomes. There is no separately mutable campaign status. Inspect recipient attempts for accepted/failed/uncertain evidence. A removed recipient reflects profile deletion rather than a delivery result. History pages use stable IDs. Drafts can be reviewed again from saved history after a reload; a dispatched draft is shown as dispatched, so a lost browser response does not require creating a replacement campaign.

Campaign snapshots retain internal audience IDs and hashed phone/consent fingerprints, not names or raw numbers. Private messages/attempts are deleted with the customer; minimal campaign/audit history remains. Campaign text should be a shared announcement, without personal customer details.

## Admin handover walkthrough

1. In Account Settings, review Student/Regular daily and one-month rates. Historical purchases retain their snapshots. Unconfigured package/custom-expiry choices stay unavailable.
2. Register a synthetic consenting test customer locally, confirm required category/source fields, and approve the pending profile separately from payment. Check daily attendance and restricted customer payment status; preserve existing visits and weight history.
3. In Payment review, inspect cash received or the private GCash receipt, OCR/reference/amount suggestions and coverage. Correct evidence with an audit reason, then separately approve or reject. Pending/rejected renewals never extend membership. A refreshed review is required if membership changed.
4. Process OCR/retry work and retention cleanup from the existing local admin controls. Maintain dispute/legal holds and bookkeeper-confirmed dates; do not infer expired evidence from profile deletion.
5. Reconcile Overview/Statistics expected, pending and confirmed values with source records. Use Audit history to review protected profile, pricing, payment, receipt and SMS changes. See the non-SMS guides for reporting dates, cutover and privacy rules.
6. Follow the gateway setup steps above, record permission, review templates/time, request a test and inspect actual delivery evidence before live activation. Exercise read-only reminders, then queue/worker controls. Preview a small authorized campaign, review its audience and dispatch explicitly. Never use the real roster for an unrequested test blast.
7. Before deployment, complete the deferred host/runtime/rules/secret rollout, repeated reminder scans and sending-worker schedule, OCR/photo maintenance schedule, real phone/browser walkthrough, gateway delivery/failure evidence and separate RFID hardware verification. These remain handover requirements, not claims made by local tests.

API references checked October 28, 2026: [sending messages](https://docs.sms-gate.app/features/sending-messages/), [status tracking](https://docs.sms-gate.app/features/status-tracking/), [authentication/API](https://docs.sms-gate.app/integration/api/), [local server](https://docs.sms-gate.app/getting-started/local-server/). The adapter uses modern `textMessage`, a custom `id`, a one-hour TTL and requested delivery reports. Local and cloud URL prefixes differ.
