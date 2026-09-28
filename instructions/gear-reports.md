# Gear Exchange local listing reports

Uncommitted local-only increment, baseline `37e2738`, on
`codex/gear-exchange-foundation`. No production API, migrations, dependencies,
moderation actions, notifications or deployment. Use sample gear only.

## Run and inspect

Use the existing Node 24 HTTPS launcher:

```bash
node scripts/gear/local-preview.mjs /tmp/postandin-gear-reports.sqlite
```

Open `https://127.0.0.1:8773/gear/`, publish sample gear through explicit local
verification, then open its detail and Report this listing. Choose a reason and
select Save to local review queue. Inspect the JSON queue in the same browser at
`https://127.0.0.1:8773/local/reports`.
See [gear-connected-preview.md](gear-connected-preview.md) for certificate and
sample-data boundaries. No report is sent to a moderator or acted on.

## Contract

- `POST /reports`: JSON `{id,reason}` with exact same-origin Origin required.
  Supported reasons come from shared `REPORT_REASONS` in `lib/gear-exchange.mjs`:
  Misleading listing, Spam or suspicious activity, Prohibited item, Other concern.
  Client and server use the same values. Unknown fields are ignored; no reporter
  identity, email, free-text allegation or requested moderation action is stored.
- Existing host/rebinding, cross-site, JSON and 32 KiB body guards apply. GET
  does not submit anything. Responses are no-store and unexpected errors are
  logged server-side with a generic public message.
- Submission requires an available/pending listing, verified listing and seller,
  and expiry strictly after the submission time. Eligibility uses a direct bound
  SQLite lookup, independent of the browse query's 100-record limit. Unavailable
  listings receive the same 404 message, including stale browser views.
- The server records only a generated report ID, listing ID, title snapshot,
  reason and timestamp in milliseconds. Text stays JSON data, not HTML. Reports
  are not added to public listings and never change listing state, verification,
  expiry or seller access. Acceptance and queue insertion are synchronous.
- `GET /local/reports` is trusted loopback inspection tooling, not an
  authenticated owner dashboard. It must never become a public Pages route.
  Existing origin/host guards apply, but any trusted local client may inspect
  it, as with the other local simulated inboxes. Queue titles may outlive a
  listing's public eligibility until eviction or server restart.
- The queue holds the latest 20 accepted reports; older reports are evicted.
  It is memory-only and clears on restart, with no backup, durable retention,
  resolution state or restore claim. This is a development inspection queue.
- Temporary limits: three validated attempts per listing and twenty across the
  server per rolling ten minutes, shared by all local clients. Unavailable
  listing and database-failure attempts count; malformed requests and already
  limited attempts do not. Attempt metadata has at most twenty entries.
  Counters clear on restart. Any local caller can exhaust these budgets; these
  limits are not production abuse protection or per-person fairness.
- The form validates before freezing controls, blocks repeated pending writes,
  preserves the selected reason on failure, and resets only after confirmed
  acceptance. Success receives focus. Cancel and navigation reset the form.
  Static hosting keeps simulated reporting with no API request.
- No automatic retry or idempotency: a lost response after acceptance can leave
  the user unsure whether it was queued, and a retry may add another report.
  No moderation action or notification is implied by a success response.

## Verification and review

```bash
node --test tests/gearReports.test.mjs tests/gearContact.test.mjs tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
git diff --check
```

Observed: all 72 Node tests pass, including five report tests for validation,
public eligibility and exact expiry, explicit queue fields, unchanged listings,
queue bounds, rolling limits, HTTP privacy/Origin/method/body guards, concurrent
submissions and safe database failures. Changed JavaScript syntax checks pass.
The HTTPS Chrome harness passes required reason validation, a real stale-listing
404 and limit 429, mocked 500 recovery, repeated clicks during a held request,
queue contents, reset/focus/cancel, static isolation and no unexpected console
errors or page exceptions. Layouts pass at 1040/390/320 pixels; desktop and mobile
screenshots were visually inspected. No D1/workerd rerun: this increment uses
local SQLite and adds no migrations or D1 operations.

Owner-mediated Claude review approved this local-only increment with zero
blocker/high/medium/low findings. Claude independently passed all 72 Node tests,
the five report tests separately, syntax/diff checks and the HTTPS Chrome harness.
Optional restart/HTTP-eviction coverage and static-preview focus improvements
were not defects or blockers and remain deferred. Codex checked the review
against the code; no implementation changes were required.

Review baseline: `37e2738`. Included in the local commit titled
`Connect local Gear reports to a review queue`; use Git history for its hash.
No push, merge, provisioning or deployment.

Next separate increment: owner-authenticated moderation, after deciding the
allowed actions and review workflow. Durable retention, deletion, restore,
remote APIs and real mail remain separate. The owner requires the project to be
fully complete before any separately authorized deployment.
