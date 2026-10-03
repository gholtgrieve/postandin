# Gear Exchange local buyer contact

Development-only increment on `codex/gear-exchange-foundation`, based on
`c2baff3`. No production route, real mail, binding, dependency or migration.

## Run and inspect

Use Node 24 and the existing sample-data HTTPS launcher:

```bash
node scripts/gear/local-preview.mjs /tmp/postandin-gear-contact.sqlite
```

Open `https://127.0.0.1:8773/gear/`, create and explicitly verify sample gear,
then open its detail and Contact seller. Complete the form. “Save to local test
inbox” submits to the local server;
success explicitly says no email was sent. Inspect receipts at
`https://127.0.0.1:8773/local/contact-mail` in the same browser.
Only use sample names, addresses and messages. Startup and certificate details
are in [gear-connected-preview.md](gear-connected-preview.md).

## Contract and boundaries

- `POST /contact`: JSON `{id,name,email,message}` and exact
  same-origin `Origin` required. No seller login is needed. Existing host,
  cross-site, body-size (32 KiB), JSON and no-store guards apply.
- Server validates name (1–60 characters), normalized email (up to 254), and
  message (1–2000, allowing normal line breaks).
  Unknown recipient/ownership fields are ignored. Unsupported control characters
  are rejected after text normalization.
- At submission, a bound SQLite query requires available/pending status,
  verified listing and seller, and expiry strictly in the future. Pending gear
  remains contactable, matching public browse. The current seller record chooses
  the recipient, including after a verified email transfer. No query pagination
  limit affects contact eligibility.
- The sink keeps plain-text receipt fields, never HTML or email headers. The
  public success response includes neither buyer details nor seller email.
  `GET /local/contact-mail` is a **trusted local inspection endpoint**, like the
  existing simulated inboxes; it includes private sample details and must never
  become a public Pages route or be used with real personal data.
- Only the latest 20 receipts remain in memory. They disappear on server restart;
  they are not stored in SQLite or included in backups. This is a bounded test
  sink, not durable delivery or a restore implementation. Built-in contact
  copies expire after 24 hours; see `gear-lifecycle.md` for automatic cleanup.
- Temporary local limits per rolling ten minutes: 3 attempts per normalized
  buyer email/listing pair, 5 per buyer email, 60 across the server. Validated
  attempts count even when the listing is unavailable or the sink fails. Malformed
  requests do not count. Attempt metadata is bounded to 60 entries and uses email
  hashes. Limits reset on restart; this is not production abuse protection or
  proof that the buyer owns the supplied address.
- Sink acceptance and eligibility checking are synchronous within the local Node
  process. Test injection via `contactSink` must return literal `true`; missing,
  false or throwing sinks cannot report success. Unexpected failures are logged
  server-side with only a generic public error. This is not an async mail adapter.
- UI disables repeated submissions while pending, preserves inputs/consent on
  failure, and clears them only after confirmed acceptance. No automatic retries.
  A lost response after acceptance is ambiguous: retry can create another receipt.
  Durable outbox/idempotency and real delivery remain separate work.
- Static hosting still simulates contact and makes no API call. It also requires
  the sharing acknowledgement. Reporting now has a separate local queue; see [gear-reports.md](gear-reports.md).
  Static reporting remains simulated.

## Verification and owner review

```bash
node --test tests/gearContact.test.mjs tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
git diff --check
```

Observed: 67 Node tests pass, including six contact tests covering validation,
visibility/expiry, current recipient, response privacy, local limits, bounded
receipts, Origin/JSON guards and failed sinks. The HTTPS Chrome harness passes
contact acknowledgement, failed-response recovery, successful receipt contents,
reset/focus, static isolation, and desktop/mobile overflow at 1040/390/320 pixels.
Desktop and mobile contact screenshots were inspected. No unexpected console
errors or page exceptions. Changed JavaScript syntax checks and diff checks pass.
D1/workerd was not rerun: this increment uses the existing local SQLite adapter
without changing migrations or the production/shared D1 code.

Owner-mediated Claude review concluded **ready to merge for this local-only
increment**, with no blocker/high/medium findings and two low-priority coverage
findings. Claude independently passed the 67-test suite, syntax/diff checks and
HTTPS Chrome harness. Codex verified the findings against the implementation
and added regressions for recipient selection through a real verified mailbox
transfer (including retained old seller and changed listing ownership), malformed
requests not consuming attempts, failed sinks consuming attempts, and successful
contact one millisecond before expiry. All 67 tests pass after those additions.
No runtime or frontend behavior changed in these follow-ups; the browser harness
was not rerun and no second Claude review was performed.

Review comparison: baseline `c2baff3` through the local commit titled
`Connect local Gear buyer contact to a test inbox`; use Git history for its hash.
No push, merge, deployment or real-mail approval.

Policy increment (baseline `87c1805`): buyers must explicitly acknowledge being
18 or older, independently of email-sharing consent. Both the local server and
form enforce this; the acknowledgement is not age verification and no birthdate
is collected. Posting separately checks an adult acknowledgement.
