# Gear Exchange implementation plan

Status: development preview, September 27, 2026. `/gear/` is an unlinked,
noindex design preview. A local-only draft-storage API now exists separately;
there is no deployed API, cloud storage, email service or homepage link. The external prototype
is a design reference, not production code.

## Resume here

This section is the Gear Exchange handoff. Read it before implementing more.
It records the state at handoff; recheck Git and actual code rather than assuming
that branch, test results or running local servers remain unchanged.

### Checkout and completed work

Work only in `/Users/gordonholtgrieve/Dropbox/Documents/postandin`, which resolves
to the Dropbox team folder. Read `AGENTS.md` and `CLAUDE.md`. Do not implement
in a generated Codex folder or copy the repo there.

Branch at handoff: `codex/gear-exchange-foundation`.

| Commit | Completed increment |
|---|---|
| `d042d26` | Shared listing options and public search helpers |
| `7b85550` | Repo-based development preview and design-review fixes |
| `7996db6` | Validated local draft storage, tests and storage-review fixes |
| `3667c9d` | Documentation handoff and agent discovery |
| `c2acb18` | Local verification, publication-only duplicate checks and upgrade tests |
| `06be078` | Reviewed local seller management and duplicate cleanup |
| `5cada4b` | Reviewed local verified email transfers |
| `32808e8` | Session recovery and HTTPS browser checks |
| `2d33253` | Local D1/workerd validation |
| `afd29ba` | Reviewed connected local HTTPS preview |
| `7753fa2` | Reviewed local email-change management UI |
| `26cb8a2` | Production owner moderation actions |
| `b73385e` | Production seller-deletion foundation |
| `6bed4ae` | Production seller deletion/recovery writes |
| `d7da481` | Production seller management sessions |
| `2944ffb` | Production scheduled maintenance |
| `e851788` | Private production photo sanitization foundation |
| `cfbc2cc` | Owner-approved 25-megapixel Gear photo limit |
| `b7002f5` | Durable production photo quarantine state |
| `bfafb1a` | Dedicated Gear Images service Worker foundation |
| `050c87d` | Authenticated production photo upload/finalize routes |
| `329ef5f` | Scheduled orphaned-photo reconciliation |
| `0cecb52` | Authenticated production photo removal/reorder routes |

These commits were created locally. No push, merge, production migration or
provisioning was performed during this work. The documentation handoff is maintained in subsequent documentation commits;
inspect `git status` and recent history before continuing.

### What actually works

| Component | Implemented | Not implemented |
|---|---|---|
| `/gear/` preview | Static demo; opt-in local HTTPS posting/browse/management with persistence and local contact/report queues | Real email/cloud media; production publishing |
| Shared modules | Options, public search, price formatting, server content validation | Identity or authorization checks |
| Local storage | SQLite persistence through a D1-shaped adapter; atomic seller/listing/club inserts | Production D1 deployment (local binding validation now passes) |
| Local API | Drafts, token confirmation, public projection, local authenticated management | Any Pages route, real mail |
| Public query | Explicit public fields, listing/seller verification checks, status and read-time expiry | Deployed publication endpoint, pagination, search API, cleanup job |

The ordinary static demo's managed records and public samples are separate arrays.
Connected mode replaces both with API reads; persistent local photos are now
available through listing management (see `gear-photos.md`). Do not mistake simulated verification,
renewal or deletion for backend behavior. `readLocalDraft` exposes private sample
email for trusted local inspection and must never become an unauthenticated
Pages handler. All timestamps use milliseconds.

### Current increment: connected local preview

The owner resumed work September 27 after the requested overnight stop.
Claude's D1 review approved `2d33253`; optional coverage and documentation
follow-ups now pass. The connected-preview increment connects posting, explicit
local verification, recovery/login, reload, edits/status changes and browse to
the loopback HTTPS API. See [gear-connected-preview.md](gear-connected-preview.md)
for startup, exact scope, checks and review comparison. All 56 Node tests, eight
D1 groups and the connected HTTPS Chrome flow pass. The initial detailed Claude review found no high-severity issues; fixes and
expanded regression checks pass. Claude re-review found no blocker/high/medium
issues and approved the local-only increment; three low-priority follow-ups
(city normalization, safe unexpected errors and edit contact text) are fixed
and retested afterward. This increment is included in the local commit titled
`Connect Gear Exchange preview to the local HTTPS API`; use Git history for its
hash. No push, merge or deployment.

### Email-change UI increment

Connected local management now requests and confirms email transfers with the
existing backend. See [gear-email-change.md](gear-email-change.md) for behavior,
error recovery and browser coverage. Review baseline is `afd29ba` plus this
increment. Claude source review approved the local-only scope with no
blocker/high/medium findings. Minor focus, stale-state, field-reset and spacing
follow-ups were fixed and browser-tested afterward; no additional review pass.
This work is included in the local commit titled `Connect local Gear email-change management`;
use Git history for its hash. No push, merge or deployment.

### Next bounded task

The reviewed persistent local-photo increment is included in the local commit
`Add persistent photos to local Gear management` (baseline `7753fa2`); use Git
history for its hash. See [gear-photos.md](gear-photos.md)
for exact scope, macOS dependency and verification. All 61 Node tests and the
expanded desktop/mobile HTTPS browser harness pass. Claude review found no
security/access/transaction defects; its image upscaling and orientation findings
were fixed with targeted regressions. Focused Claude re-review approved the
fix with no blocker/high/medium defects. Its recommended big-endian TIFF
orientation-6 regression now passes alongside all five focused photo tests. No push, merge or deployment. Real buyer-contact delivery and moderation are still unfinished; deletion/retention, real mail,
remote APIs and restore remain separate work. Never expose private local draft
inspection or simulated inboxes as public Pages routes.

### Local buyer-contact increment

Buyer contact now validates sharing consent and sample details, checks current
listing visibility/recipient, and saves plain-text receipts in a bounded local
inbox. Connected UI preserves input on failure and never claims real email
was sent. Temporary rate limits and inboxes reset on restart. See
[gear-contact.md](gear-contact.md) for routes, exact boundaries, tests and the
owner-mediated review disposition. Baseline: `c2baff3`. All 67 Node tests and
the expanded HTTPS desktop/mobile Chrome harness pass. Owner-mediated Claude
review approved the local-only increment with no blocker/high/medium findings.
Both low-priority coverage findings are addressed: real verified transfer recipient
selection, malformed-request and failed-sink counting, and acceptance just before
expiry. The expanded 67-test suite passes; these test/documentation follow-ups
have not received another Claude review. Included in the local commit titled
`Connect local Gear buyer contact to a test inbox`; use Git history for its hash.
No migration, push, production provision or deployment. The owner requires the
project to be fully complete before any separately authorized deployment.

### Local reports increment

The existing report form now submits shared reason choices to a bounded local
inspection queue. Server checks current listing visibility, applies temporary
listing/global limits, and never modifies listings. The UI retains the reason on
failure and focuses confirmed local success. See [gear-reports.md](gear-reports.md)
for routes, privacy boundaries, memory/eviction limits and verification.
Baseline: `37e2738`. All 72 Node tests and the expanded HTTPS Chrome harness pass;
desktop/mobile screenshots were inspected. Owner-mediated Claude review approved
the local-only increment with zero findings at every severity and independently
passed the tests and browser harness. Optional coverage/focus suggestions remain
deferred; no implementation fixes were needed. Included in the local commit titled
`Connect local Gear reports to a review queue`; use Git history for its hash.
No push, migration, provisioning or deployment in this increment.

### Local owner moderation package

Baseline: `b2deab4`. Optional HTTPS owner mode uses a separate local key and
revocable session. It persists the latest 20 reports, supports reasoned
dismiss/remove/restore actions, and saves history atomically with changes.
Restore preserves expiry and prior status, rechecking current verification,
quota and duplicates. Public browse/contact/photos respect removal. See
[gear-owner-moderation.md](gear-owner-moderation.md) for key setup, routes,
local-only table changes, persistence, limitations and review commands.
All 80 Node tests and both owner and existing preview Chrome harnesses pass;
desktop/mobile screenshots were inspected. Claude approved the local-only package
with no blocker/high/medium findings. Its low-priority history-display finding
is fixed with a browser assertion; documentation now distinguishes local 404s
from future inert static hosting. The focused owner browser harness passes after
the fixes; no second Claude review. Included in the local commit titled
`Add local owner moderation and reversible Gear removal` (see Git for hash).
No push, production setup or deployment.

### Local lifecycle package — reviewed

Moderation is committed locally as `9836ff7`. The next package implements seller
deletion with the owner-approved 30-day recovery window, explicit offline cleanup
and tested SQLite record/photo backup and restore. See [gear-lifecycle.md](gear-lifecycle.md)
for commands, coverage and limitations. Included in the local commit titled
`Add local Gear deletion recovery and snapshot lifecycle` (see Git for hash).
Claude approved local-only scope with zero
blocker/high/medium findings. Its low failed-delete dialog accessibility finding
is fixed with a desktop/mobile browser regression. The owner approved retaining
report/removal text for authenticated moderation during recovery, with hidden
photos and disclosure in the deletion notice.
All 88 Node tests and both connected/owner Chrome harnesses pass; desktop/mobile
delete/recovery views were inspected. Review `git diff 9836ff7` plus untracked
lifecycle modules/tests. The owner authorized the local commit after the fixes and browser checks.
No push or deployment.
 Real mail, remote APIs and production owner
identity remain separate. No deployment until the project is fully complete
and the owner explicitly authorizes it.

### Policy and retention increment — reviewed

Baseline `87c1805`. The local preview now displays Gear rules, protective-gear
and privacy disclosures. Buyer contact requires an explicit 18-or-older
acknowledgement in the UI and local server; seller posting already requires it.
Acknowledgement is self-attestation, not identity/age verification. No birthdate
or identity document is collected. The contact acknowledgement is validated
before accepting a message; no separate consent audit record is stored.

The owner approved the shorter schedule: three-day unverified drafts, 24-hour
local contact copies, 30-day reports/history, invalid credentials removed on
cleanup, and a deletion ledger retained 30 days after purge. Active removal
state survives; old free-text reasons are replaced by a generic marker.
Automatic local cleanup runs on server listen and daily, retrying failures after
a minute; the timer stops when the server closes. Snapshot pruning is automatic
when `GEAR_BACKUP_DIRECTORY` names a dedicated outside-repo snapshot directory.
No machine-wide job or production schedule was installed. See `gear-lifecycle.md`.
All 97 Gear tests pass after review fixes; both HTTPS browser harnesses passed
before these backend-only fixes. Claude found one medium reason-retention issue
and one low backup-directory configuration issue. Both are fixed with regressions;
no second Claude review.

Review baseline: `87c1805`. Owner authorized the fixes and local commit, titled
`Add Gear policies and automatic local retention cleanup` (see Git for hash).

### Source-only Pages listings increment — committed

The production-integration assessment selected one read-only seam before any
write-capable work. `GET /api/gear/listings` now reads the existing explicit
public projection through a proposed `GEAR_DB` Pages binding, adds empty photo
arrays until the Cloudflare Images increment, and returns `no-store` responses
with generic missing-binding and query-failure errors. The static Gear UI is not connected.
Focused tests cover current visibility, exclusion of private fields, the
100-listing cap and deterministic ordering, response headers, missing
configuration and safe D1 failure. All 101 Gear tests pass with this four-test
increment included.

Committed locally as `057e312` (`Add read-only Gear Pages listings route`).

No remote binding or database was configured, no migration was applied, and
nothing was deployed.

### Production foundation increment — committed

The owner approved Cloudflare Access for a private `gear-admin.postandin.com`
moderation surface with exact identities and MFA; existing Cloudflare Images
with Direct Creator Upload, private images, random provider IDs and signed
delivery URLs; Resend using `gear@postandin.com` with buyer contact as Reply-To;
a dedicated daily maintenance Worker with one-minute retry plus failure/recovery
alerts; and nightly encrypted backup to a separately controlled non-Cloudflare
provider. The owner identity list, Access identity provider, alert recipients,
backup provider and credentials remain deployment-time inputs and are not stored
in the repo.

The bounded source change adds migration 7, which records immutable seller adult
acknowledgement time/version and a `gear_photos` table containing only hosted
Cloudflare Images IDs and ordering. `lib/gear-photo-storage.mjs` supplies the D1
metadata boundary without uploads, URLs, authorization or network calls. Legacy
listings remain unacknowledged rather than fabricating consent. Focused temporary
SQLite tests cover upgrade preservation, trigger enforcement, immutability,
identifier validation, six-photo limits, ordering, uniqueness and cascade delete.
No cloud resource, binding, route, credential or deployment configuration is
included. The updated seven-migration workerd/D1 harness passes with the installed
Wrangler 4.107.0 stack, including the populated version-6 upgrade and persistence.
The full Gear suite passes with 105 tests.

Production photo routes must reconcile upload-before-metadata failures so an
unrecorded Images object cannot persist. Permanent cleanup must delete the remote
Images objects before cascading their D1 metadata, or persist provider IDs in a
durable deletion outbox first. Both paths must be idempotent, retryable and covered
by the scheduled Worker's failure/recovery alerts; they are explicitly deferred
to the Images and maintenance increments.

Owner-mediated Claude review found 0 blocker, 0 high, 0 medium and 3 low issues,
with a `Ready to commit` verdict. All three low items are addressed: photo
insertion now fills the lowest free position, the database requires the
acknowledgement time to equal creation time and recognizes only the current
disclosure version, and the remote Images reconciliation rules are explicit.
Regression tests cover gap reuse, mismatched times and unknown versions. The
first post-review workerd run exposed its lower compound-SELECT limit; the slot
query now uses the already-supported `json_each` pattern. The corrected eight-group
workerd harness and all 105 Gear tests pass. No second Claude review was requested.

Committed locally as `150a984` (`Add Gear production storage foundation`).

### Production owner authentication — committed

The source-only owner boundary validates `Cf-Access-Jwt-Assertion` with native
Web Crypto. It requires HTTPS on `gear-admin.postandin.com`, an RS256 signature
from the configured team-domain JWKS, exact issuer and application audience,
bounded time claims and an email in the environment-provided owner allowlist.
Plain JWK data is cached for five minutes and an unknown `kid` can force one
refresh per team domain per minute for key rotation. Tokens and JWKS responses
are bounded. Missing configuration or key-service failures fail closed with a
generic 503; invalid identities and tokens receive a generic 403.

`GET /api/gear/admin/session` returns only `authenticated:true` after verification
and performs no read or write. No real identity, team domain, audience, Access
application, custom domain, binding or secret is present in the repo. Focused
tests generate temporary RSA keys and cover success, spoofing/failure paths,
clock boundaries, configuration failures, cache reuse and key rotation. See
`gear-access.md`. The final verifier and handler also pass a local
Miniflare/workerd run with mocked keys, including valid access, cache reuse,
denials, cooldown expiry and redirect rejection. The complete Gear suite passes
with 112 tests.

Owner-authorized direct Claude review initially found 1 high and 3 low issues:
Workers incompatibility in the JWKS redirect mode, Unicode identity folding,
unthrottled unknown-key refreshes and missing adversarial coverage. All were
fixed with regression tests. Focused re-review confirmed the final source in
workerd and found 0 blocker, 0 high and 0 medium code issues. Its sole remaining
low item was this documentation update; the verdict is `Ready to commit`. Once
merged, the route exists on Pages but remains inert with a generic 403 on every
host except the dedicated admin host until that domain and Access configuration
are owner-authorized and supplied.

Committed locally as `2efd790` (`Add Cloudflare Access owner boundary for Gear`).

### Production moderation read foundation — committed

Migration 8 adds production `gear_reports`, `gear_removals` and
`gear_moderation_history` tables with bounded enum, status, reason and timestamp
constraints. The names deliberately differ from the local-only moderation
tables. Reports and active removals retain listing foreign keys so permanent
purge must remove them first; history intentionally has no foreign key so its
bounded audit record can survive until independent retention cleanup.

`GET /api/gear/admin/reports` verifies the existing Cloudflare Access assertion
before checking `GEAR_DB` or running a query. It returns at most the newest 100
open reports with current listing review fields and a `truncated` flag when older
open reports remain. The projection omits seller email/ID, duplicate keys,
acknowledgement evidence and Cloudflare Images IDs.
Missing auth/configuration/binding and database failures return generic no-store
responses. The route is read-only: there is still no production report
submission, moderation action, owner UI connection or remote cleanup.

Focused tests cover migration constraints, ordering/capping, field privacy,
auth-before-D1 behavior and generic failures. The eight-migration D1 harness
passes on Wrangler 4.107.0 / Miniflare 4.20260701.0 / workerd 1.20260701.1,
including the production moderation projection and populated version-6 upgrade.
The complete Gear suite passes all 116 tests. See
`gear-production-moderation.md`.

Owner-authorized Claude review found 0 blocker, 0 high, 0 medium and 3 low
issues, with a `Ready to commit` verdict. All three lows are addressed:
`gear_reports.listing_id` is indexed before migration 8 is applied anywhere,
the bounded queue signals truncation, and regression coverage proves Access
denial happens before binding inspection or D1 work through both injected and
real handler wiring. Claude could not run its workerd command because of its
session permissions; Codex ran the documented harness successfully before and
after these fixes.

Committed locally as `4d3b634` (`Add production Gear moderation read foundation`).

### Production report submission — committed

`POST /api/gear/reports` now provides the source-only public write boundary. It
requires the exact `https://postandin.com` request URL and Origin, rejects
cross-site browser requests, accepts only bounded JSON, validates the listing ID
and shared reason, and requires server-side Turnstile verification for hostname
`postandin.com` and action `gear-report`. The secret is an environment-only
deployment input. The client token and reporter IP are never stored; the user IP
is not sent to Siteverify.

After verification, one bound `INSERT ... SELECT` atomically rechecks listing
and seller verification, available/pending status and strict future expiry while
capturing the title snapshot. Only the report ID, listing ID/title, shared reason,
time and open resolution enter D1. Missing configuration and upstream/database
failures return generic no-store responses. Invalid or replayed Turnstile tokens
do not touch D1.

Turnstile is mandatory but not the only launch abuse control: a Cloudflare edge
rate-limit rule for this endpoint must be configured and verified before the UI
is connected. No widget/site key, secret, WAF rule, remote D1 binding or
deployment was created. Five focused tests cover the request, verifier, storage
and failure boundaries; the complete Gear suite passes all 121 tests. The
workerd-backed D1 harness passes atomic acceptance and ineligible-listing
rejection. See
`gear-production-reports.md`.

Owner-authorized direct Claude review concluded **ready to commit** with 0
blocker, 0 high and 0 medium findings. Its four low-priority findings are
addressed: configuration/request mismatches now leave a generic token-free
operator diagnostic; request, token, Siteverify response/timeout and real-handler
wiring boundaries have regressions; the workerd harness proves an ineligible
listing inserts nothing; and the deployment notes now state that ordinary Pages
preview hosts are intentionally denied. All focused checks, the nine-group D1
harness and all 121 Gear tests pass after these changes. No second Claude review
was requested.

Committed locally as `9e20410` (`Add production Gear report submission`).

### Production moderation actions — committed

`POST /api/gear/admin/actions` now provides the source-only owner write boundary
for `dismiss`, `remove` and `restore`. It requires the exact admin URL and Origin,
bounded JSON and the existing Cloudflare Access identity before inspecting D1.
The verified owner email, never a client-provided actor, is stored in bounded
moderation history.

Each accepted action runs as one D1 transaction. Dismiss preserves the listing;
remove records prior available/pending state, removes the listing, resolves the
report and writes history; restore preserves expiry and rechecks verification,
quota and live duplicates while expiring only stale duplicate rows. Stale,
ineligible and replayed actions make no changes. Audit or constraint failure
rolls back all related writes. The post-batch result check is a diagnostic alarm
only; all rollback claims refer to failures raised inside the D1 batch.

Seven focused tests cover transitions, conflicts, rollback, request bounds,
Access-before-D1 behavior and generic failures. The workerd harness exercises
all three actions and injected audit-failure rollback against actual D1. No owner
UI was connected and no remote resource or policy was changed. See
`gear-production-moderation.md`.

Owner-authorized Claude review found 0 blocker, 0 high, 1 medium and 3 low
issues. The actor-source regression, post-commit diagnostic wording,
seller-deletion provisioning gate and documentation drift were fixed. Focused
re-review found 0 issues at every severity and concluded **ready to commit**.
Committed locally as `26cb8a2` (`Add production Gear moderation actions`).

### Production seller-deletion foundation — committed

Migration 9 adds the production `gear_deletions` active recovery marker and the
independent minimal `gear_deletion_ledger`. Both use constrained millisecond
timestamps; the active marker cascades with a purged listing while the ledger is
retained for future anti-resurrection and backup reconciliation. Due-time indexes
support later cleanup without adding a scheduler in this slice.

Owner moderation restore now fails with no writes while an active seller-deletion
marker exists. Tests cover schema constraints, marker cascade, ledger survival,
unchanged moderation state while blocked, and successful owner restoration only
after simulated seller recovery removes the marker. The workerd harness exercises
the same guard through actual D1. See `gear-production-deletions.md`.

Owner-mediated Claude review found one medium and four low issues. The ignored
documentation file, seller-write contract, external reconciliation requirement,
historical counts and missing restore-guard regressions were fixed. Re-review
found 0 issues at every severity and concluded **ready to commit**. Committed as
`b73385e` (`Add production Gear seller deletion foundation`).

### Production seller deletion/recovery writes — committed

`POST /api/gear/management/deletion` now accepts bounded exact-origin JSON and
requires a production-only `__Host-gear_session` cookie plus derived CSRF value,
both matched to the existing hashed management-session state.
Delete and recover recheck credential validity and listing ownership inside each
D1 batch. Delete immediately hides the listing while atomically creating its
30-day marker and ledger. Recovery preserves owner moderation, never extends the
deadline or listing expiry, rechecks verification/quota/duplicates and expires
stale duplicates transactionally. Current writes keep every active marker paired
with its matching unpurged ledger; future purge/reconciliation must preserve that
invariant until permanent cleanup and test owner-moderated records explicitly.

Twelve focused tests cover HTTP/credential boundaries, including foreign and
race-revoked recovery of owner-moderated records, plus replayed/overdue actions,
public/report/moderation separation, owner removal, verification, quota,
duplicates, elapsed recovery and injected delete/recover rollback. The workerd
harness exercises authenticated deletion, hiding and recovery against actual D1.
No production management-link email/session issuance, UI connection, permanent
purge, remote cleanup or restore reconciliation is included. See
`gear-production-deletions.md`.

Direct Claude review found two medium and four low issues. The transaction result
checks, session-race behavior, owner-moderated recovery, deletion-ledger pairing,
cookie parsing and documentation were corrected and regression-tested. Two
re-reviews found no issues at any severity and concluded ready to commit. Committed
as `6bed4ae` (`Add production Gear seller deletion writes`).

### Production seller management sessions — committed

Four POST-only Pages routes now provide the production credential boundary:
generic recovery request, explicit one-use token confirmation, stable reload
recovery without renewal, and CSRF-protected logout. Successful confirmation
sets the host-only `__Host-gear_session` cookie with Secure, HttpOnly,
SameSite=Strict and Path=/; JSON never returns the raw session. Link tokens remain
hash-only in D1 and are carried in the email URL fragment so an ordinary page GET
does not redeem them or put them in the request URL.

The Resend adapter uses the approved `gear@postandin.com` sender and an
environment-only API key. Tests mock every provider call; no real message was
sent. Known addresses, unknown addresses and provider delivery failures receive
the same generic 202 response, while delivery work is attached to the Pages
request lifetime. The static UI remains disconnected. Before UI connection or
deployment, provision per-IP/per-recipient recovery throttling and bot protection,
configure/verify the sender and secret, then validate the production-host-only
flow behind a temporary owner-only gate while the public UI remains disconnected.

Direct Claude review found one high and four low issues. The Workers-incompatible
`redirect:'error'` option was replaced with supported manual redirect handling;
a mocked outbound workerd probe now guards the runtime behavior. The low findings
were also addressed: failed logout clears stale cookies, recovery reuses the
shared mailbox normalization (including non-ASCII addresses), delivery logs use
non-sensitive reason codes, and the production-host-only validation procedure is
documented accurately. All 150 Gear tests and all ten workerd/D1 groups pass after
the fixes. Focused Claude re-review found 0 blocker, 0 high, 0 medium and one low
documentation-precision issue, concluded **ready to merge**, and independently
re-ran the real adapter in workerd with mocked outbound delivery. The harness
wording was narrowed afterward to distinguish its runtime-option probe from the
Node adapter test; no code changed after the clear verdict.

Committed locally as `d7da481` (`Add production Gear management sessions`).

### Production scheduled maintenance — committed

Migration 10 adds a durable hosted-photo deletion outbox. Production cleanup
copies every provider ID into that outbox in the same D1 batch that permanently
purges a due seller deletion or three-day unverified draft, so the subsequent
listing cascade cannot lose the remote deletion work. The cleanup core also
applies the approved invalid-credential, 30-day report/history, generic retained
removal-reason and 30-day post-purge ledger rules, removes orphan sellers, and
drains bounded pages. A missing hosted image counts as success; provider failures
increment only non-content attempt metadata and leave the outbox row for retry.
The hosted-image queue drains before records and again afterward with the
remaining budget; failed rows rotate behind untouched work.

A dedicated scheduled-only Worker runs daily independently of Pages traffic. It
validates every binding and alert setting before cleanup, retries once after one
minute within the scheduled invocation, persists only failure episode state in a
dedicated KV namespace, sends one failure alert after the retry and one recovery
alert after a later successful run, and exposes no fetch route. Its checked-in
Wrangler file is an inert example: no D1/Images/KV identifier, recipient, secret,
cron or Worker has been provisioned or deployed. This is deliberately separate
from the existing schedule/RSVP Worker. Both attempts share a 900-D1-operation,
13-minute invocation budget and each attempt is capped at 440 operations.

The first independent Claude review found 0 blocker, 1 high, 1 medium and 2 low.
All findings were accepted: the unsupported numeric entry-module export was
removed and guarded by loading the real Worker in workerd; shared D1/deadline
budgets and image-first draining were added; recovery-alert failure no longer
reruns successful cleanup; failure codes are logged before alert state; and
failed image rows rotate behind untouched work. Re-review found 0 blocker, 0 high,
0 medium and 3 low and concluded ready to merge. All three lows were accepted:
post-record draining now absorbs newly staged photo bursts, four-second image
waits and a five-minute record reserve prevent an Images outage from starving
record purges, and fallback D1 attempt updates are charged to the operation
budget. A final targeted re-review is pending because these change scheduling logic.

The final targeted review found 0 blocker, 0 high, 0 medium and 2 low and again
concluded ready to merge. Both lows were accepted: an all-failed image page now
stops that drain instead of repeatedly cycling the same rows, and an empty queue
can be confirmed inside the five-minute reserve without creating a false backlog.

Remote encrypted backup, restore reconciliation, production photo routes and
buyer-contact delivery remain separate launch requirements.

All 167 Gear tests, all ten workerd/D1 groups, JavaScript syntax checks and
`git diff --check` pass after the final fixes. No deployment has occurred.

Committed locally as `2944ffb` (`Add production Gear scheduled maintenance`).

### Production photo sanitization/upload — committed

`lib/gear-image-upload.mjs` implements the owner-approved private quarantine and
sanitize flow. It issues a ten-minute signed-only Direct Creator Upload, reads
back the actual private bytes, enforces 5 MiB/25 MP/12,000-side input bounds,
uses Cloudflare decode and still-WebP scale-down to a 1600-pixel box, and verifies
the returned RIFF container structure, safe feature flags, expected scale-down
dimensions and absence of metadata, animation or unknown chunks.
Only verified output (at most 10,000,000 bytes) is uploaded as a new private
image with its quarantine ID as a non-personal reconciliation key. The original
quarantine is deleted, with failed cleanup IDs exposed only for durable route
compensation. This refines the earlier Direct Creator Upload
decision: the direct object is temporary quarantine, never the published image.

Thirteen mocked-binding tests cover upload issuance, response validation, streamed
decode input, exact transformed bytes, byte/dimension bounds, container rejection,
lossy/lossless/alpha acceptance, quarantine gates, generic failures, private
upload enforcement and cleanup compensation. The
offline Miniflare transform did not complete a disposable local fixture, so the
real Images transform/upload path remains an isolated-staging check rather than
claimed local evidence. No route, binding, resource or deployment was added.

Next within this area: pin a toolchain that supports hosted Direct Creator Upload;
add a dedicated Images Worker reached through a Pages service binding; implement
management-authenticated quarantine ownership and attachment/removal/reorder;
reconcile abandoned quarantines and unreferenced sanitized images; compensate D1
failures through immediate delete or the durable deletion outbox; and project
short-lived signed URLs. `pending` and `unavailable` finalization attempts remain
retryable and do not consume quarantine ownership.

Claude's initial review found 0 blocker, 0 high, 2 medium and 5 low findings.
The medium findings were resolved with independent output verification, immediate
compensation, stronger tests and a required sanitized-orphan reconciliation
sweep. Focused re-review found 0 blocker, 0 high, 1 medium test-coverage gap and
1 low valid-WebP false rejection. The requested regression tests were added and
transparent extended-lossless WebP is accepted. The owner approved raising the
pixel ceiling from 24 million to 25 million while retaining the 5 MiB byte cap;
both local and production boundaries now accept 5712×4284 phone photos and reject
anything above 25 million pixels. All 181 Gear tests and syntax/diff checks pass.

The foundation was committed locally as `e851788` (`Add private Gear photo
sanitization foundation`); the owner-approved pixel-limit follow-up was committed
as `cfbc2cc` (`Raise Gear photo pixel limit`). No source from this package is
deployed or imported by a production route.

### Production photo quarantine state — committed

Migration 11 and `lib/gear-photo-quarantine.mjs` add source-only D1 ownership and
in-flight attachment state for private Direct Creator Upload quarantines. A
ten-minute quarantine is bound to the current verified seller and listing. A
five-minute, hash-only claim lease prevents concurrent finalization. Attachment
rechecks the live management session, CSRF value, seller/listing ownership,
listing state and claim inside one D1 batch, chooses the lowest free photo slot,
stages the original provider ID in the deletion outbox, and consumes the
quarantine only after the metadata insert succeeds. Successful attachment replay
returns a distinct non-compensating `attached` result rather than an ambiguous
failure, preventing a route from deleting an image referenced by a live listing.

The state row deliberately survives listing deletion and email ownership transfer
so remote cleanup work cannot be lost. A six-slot conflict retains the sanitized
provider ID for cleanup and cannot later attach after a slot becomes free; a
failed batch rolls that ID back. Issuance atomically caps combined attached photos
and live reservations at six per listing. Focused SQLite tests cover schema
constraints, cross-seller access, expiry/lease boundaries, wrong and stale claims,
session revocation, state and transfer invalidation, insert rollback, replay,
successful attachment and slot conflict. The eleven-migration workerd/D1 harness
independently exercises the adapter and injected-failure rollback using temporary
storage only.

All 189 Gear tests, the eleven-migration workerd/D1 harness, JavaScript syntax
checks and `git diff --check` pass after the review fixes.

Claude's initial review found 0 blocker, 0 high, 3 medium and 4 low findings.
All were accepted: per-attempt attachment gating and a distinct committed-replay
outcome remove compensation ambiguity; successful attachment atomically stages
the original provider ID; security/time/race regressions were added; malformed
claim states are schema-rejected; provider validation is shared; reconciliation
is explicit; and live reservations are capped. Focused re-review found 0 blocker,
0 high, 0 medium and one optional low, with a **Ready to commit** verdict. That
last defense-in-depth item was also fixed by rejecting an identical original and
sanitized provider ID in both code and schema, with regression coverage. The
post-verdict change is a narrow validation guard and does not alter transaction
ordering.

Committed locally as `b7002f5` (`Add durable Gear photo quarantine state`). This
remains below the network boundary. No route, Worker, binding, provider call or
deployment is included. Next: connect it to a small dedicated Images Worker
through a Pages service binding, with immediate/outbox compensation;
then add removal/reorder, signed public projection, upload rate limits and
maintenance reconciliation for both quarantine originals and sanitized objects.

No push/deployment.

### Dedicated Gear Images service Worker — committed `bfafb1a`

`gear-images/src/index.js` is a small service-binding-only Worker around the
reviewed provider adapter. Its bounded internal JSON contract creates a private
Direct Creator Upload, sanitizes one validated quarantine ID, or performs an
idempotent compensation delete. It returns retryable `pending`/`unavailable`
states distinctly, carries terminal cleanup IDs only to the calling Pages
Function, uses generic public-safe failures and emits no provider IDs in logs.

The inert `gear-images/wrangler.toml.example` disables workers.dev and preview
URLs and declares only the Images binding. It has no route, service binding,
account identifier, secret or deploy command. Pages endpoints and D1 coordination
are deliberately the next slice; this Worker is not browser-facing.

Mocked-binding tests cover method, JSON/body bounds, exact shapes, provider-state
mapping, cleanup-reference preservation, generic failures and idempotent delete.
The real entry module loads in current workerd and fails closed because the
installed July 2026 runtime does not yet expose hosted Images management methods.
Cloudflare documented `createDirectUpload()` in September 2026, so a newer pinned
Wrangler/workerd must pass isolated staging before deployment. No real image was
created, transformed or deleted.

All 193 Gear tests, the eleven-migration workerd/D1 harness plus real Images
entry loading/fail-closed check, JavaScript syntax checks and `git diff --check`
pass before external review.

Claude's initial review found 0 blocker, 0 high, 1 medium and 3 low findings.
All were accepted: upload creation/config outages now return retryable 503 while
terminal sanitize failures remain 422; compensation delete has a four-second
deadline; cleanup IDs are routed directly to the durable outbox; and deployment
and test documentation includes the new Worker. Focused re-review found 0 blocker,
0 high, 0 medium and one documentation-only low, with a **Ready to commit**
verdict. The final wording now states exactly which statuses are retryable and
requires Pages to persist cleanup IDs even from create-time 503 responses. No
behavioral code changed after the clear re-review. A final real-entry run caught
and removed an unsupported numeric named export; the timeout remains an internal
constant, and the corrected Worker loads in workerd.

### Authenticated production photo routes — committed `050c87d`

Two source-only Pages handlers now join the existing management session/CSRF
boundary, D1 quarantine state and dedicated Images service contract. Upload
creation preflights ownership and six-photo capacity before provider work, then
compensates a raced D1 rejection through immediate delete or the durable outbox.
Finalize leases the quarantine, releases retryable pending/unavailable attempts,
consumes terminal failures into cleanup, and retries an indeterminate attachment
once with the identical claim and sanitized ID. Only a temporary quarantine ID,
upload URL and expiry reach the browser; sanitized IDs and claims remain private.

No Pages binding, UI, provider resource or rate-limit rule is configured. The
routes additionally require an explicit `GEAR_PHOTO_UPLOADS_ENABLED=true` launch
flag, so adding only the service binding fails closed. All service calls are
mocked in route tests, and D1 checks use temporary storage.
Next: scheduled reconciliation for abandoned quarantines and unreferenced
sanitized objects, followed by removal/reorder, signed public projection, upload
rate limits and the remaining launch operations.

The final package passes all 210 Gear tests, 29 focused photo tests, JavaScript
syntax checks, `git diff --check`, and the temporary-storage D1/workerd harness.
Claude's first review found 0 blocker, 0 high, 3 medium and 4 low issues. The
accepted fixes remove pre-attach cleanup failure, conditionally stage sanitized
objects after ambiguous double attachment failure, preserve cleanup IDs from
malformed service success, distinguish expired access, add an explicit enable
flag and cover the failure/race paths. Re-review returned **Ready to commit**
with three optional hardening items; live-photo enqueue guards, access/flag
regressions, same-ID rejection and precise durability wording resolved all
three. A final narrow review found 0 blocker, 0 high, 0 medium and 0 low issues
and again returned **Ready to commit**.

### Scheduled photo reconciliation — committed `329ef5f`

Migration 12 preserves existing hosted-photo deletion work while allowing a
provider-discovered orphan to carry no misleading listing ID. The daily
maintenance pass now atomically stages and consumes expired unclaimed
quarantines, exact-expired five-minute claim leases, and retained sanitized
conflicts. It lists both fixed private Gear image purposes with a 24-hour grace
period, validates provider metadata again, rechecks D1 immediately before each
enqueue, and protects attached photos plus retained sanitized-conflict rows.
Provider commits that precede any D1 write are protected by the grace period.

Provider listing is capped at ten 100-object pages per purpose per attempt and
saves its opaque continuation cursor after every page. A larger inventory resumes
normally on the next attempt; malformed pages and provider failures follow the
existing retry and failure-only alert path. The deletion drain excludes every currently
referenced provider ID, and retention cleanup removes a stale live-reference
outbox row without calling Images. No provider resource, cron, database, image,
mail or deploy operation is part of this increment.

Cursor progress is coalesced to one KV write per attempt only when it changes. A
rejected saved cursor is cleared and retried once; unreadable or malformed cursor
state falls back to an empty sweep and cannot block record cleanup. Provider-side
purpose filtering is only an optimization because every returned object is
revalidated client-side.

### Authenticated production photo removal/reorder — committed `0cecb52`

Source-only Pages handlers now let a seller remove one attached photo or submit a
complete order of the listing's current photo IDs. The D1 adapter rechecks the
live session, CSRF, seller/listing ownership, manageable state and an exact bounded
photo snapshot inside the mutation batch. Removal writes the provider ID to the
durable deletion outbox before replacing the metadata set; reorder never touches
provider storage. Concurrent upload/removal changes lose safely rather than
dropping new metadata or resurrecting a removed object. Responses expose no
provider IDs, and no UI, binding, resource or deployment is included.

### Signed public photo projection — current increment

The source-only public listings route now reads visible listing fields and their
ordered attached photo references in one D1 statement, then replaces each private
reference with a ten-minute signed `imagedelivery.net` URL for the configured
Cloudflare Images account hash and fixed public variant. The signing key stays in
the Pages secret binding, all photos in one response share one expiry, and the
route fails closed on missing configuration or malformed stored references. It
does not return a standalone provider ID or sign photos for hidden listings. No
UI, secret, variant, binding, resource or deployment is included.

Launch must configure the three delivery settings in both Pages environments,
keep **Always allow public access** disabled on every Images variant, and accept
that an already-issued URL can remain usable for up to ten minutes after a
takedown. The existing public coach-page images do not require the variant-level
bypass.

Next after review/commit: upload rate limits and remaining launch operations.

### Checks and local commands

Run from the canonical checkout:

```bash
git status --short
git branch --show-current
# Photo tests require macOS with /usr/bin/sips.
node --test tests/gearAccess.test.mjs tests/gearLifecycle.test.mjs tests/gearModeration.test.mjs tests/gearReports.test.mjs tests/gearContact.test.mjs tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs tests/gearMaintenance.test.mjs tests/gearPagesListings.test.mjs tests/gearPagesModeration.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearPagesReportSubmission.test.mjs tests/gearPagesSellerDeletion.test.mjs tests/gearPagesManagementSession.test.mjs tests/gearProductionFoundation.test.mjs tests/gearProductionMaintenance.test.mjs tests/gearImageUpload.test.mjs tests/gearPhotoQuarantine.test.mjs tests/gearImagesWorker.test.mjs tests/gearPagesPhotos.test.mjs tests/gearPagesPhotoManagement.test.mjs
git diff --check
```

At `7996db6`: 18 focused tests passed. Local SQLite and loopback HTTP were tested;
D1/workerd was not. Syntax checks passed for changed JavaScript. Chrome checks
covered edit/new isolation, conditional offers, cents display, clubs, deletion,
focus and five-screen overflow at 1040/390/320; later price-bound checks passed
at 1040/390. Browser checks were executed through an external installed
Playwright runtime, not a checked-in automated UI suite.

Preview only (separate process, no API):

```bash
python3 -m http.server 8771 --bind 127.0.0.1
```

Open `http://127.0.0.1:8771/gear/`. The demo Homepage is inside that preview;
the real site's homepage has not received the Gear card.

Local storage API (Node 24; no package installation):

```bash
node scripts/gear/local-server.mjs /tmp/postandin-gear-dev.sqlite
```

See [gear-storage.md](gear-storage.md) for request shapes, routes, local-file
safeguards and migration limitations. Do not assume a prior server is running.
Use a new sample database filename if it predates unreleased schema edits;
never silently drop or rewrite an existing database.

### Review history, remaining notes and release boundary

Claude's preview re-review and local-storage re-review both concluded **ready
to merge for their limited development increments**, based on source only.
That is not launch approval. The last storage re-review's minor path issue was
fixed (dangling symlinks/hard links rejected), documentation was corrected, and
large-upload connection resets were explicitly accepted as a local-tool
limitation. The final minor fixes passed 18 tests but were not sent for another
Claude pass before commit.

Connected-preview integration now sorts by cents and restores management focus.
`offerFields` assumes validated browser input; production storage additionally
uses `validateDraft`. Persistent local management photos are implemented;
the trusted production sanitizer/upload foundation now exists, while attachment,
delivery and management routes remain future work.

Local D1 batch/SQL checks pass; see `gear-d1-validation.md`. Remaining
integration/launch checks: remote D1 and deployed
JavaScript MIME/cache headers, authenticated sessions, abuse limits, retention,
image sanitization/private storage, delivery failures, moderation, and tested
record/photo restore. Decide whether to record adult acknowledgement and settle
indexing policy before launch. Source files contain no credentials or user data;
Git-ignore rules alone are not a static-host privacy boundary.

Follow `AGENTS.md`: no commit, push, merge, deploy, production writes or live
credentials without the relevant owner instruction. A push to main deploys
Pages; scheduler/Worker changes have separate deployment paths. Do not add a
root Wrangler configuration that takes over Pages. Existing Groups backups do
not cover Gear. External Claude invocation requires an explicit owner request;
the owner authorized prior individual reviews, not unattended ongoing reviews.

For the connected-preview increment, compare against `2d33253` (plus untracked
files), or `main...HEAD` for the entire feature. Include exact tests and remaining
limitations. Update this handoff when the next increment changes these facts.

## Product contract

Local adult classifieds: For Sale, Trade, Free. Protective gear is allowed.
No checkout, shipping, dealer listings, ratings, or anonymous two-way relay.
Use one required Description field covering wear, repairs, damage, and unknown
history, plus a separate condition selection. Six photos maximum with a chosen
main photo; ten active listings per seller, including pending; 30-day expiry.
Publication requires email verification. Management uses revocable private links.

Location is a city, not a rink or pickup arrangement. Use city filters derived
from public listings; normalize casing and whitespace for comparison. Do not
infer a region from arbitrary city text. Spelling aliases/geocoding are deferred.

`lib/gear-exchange.mjs` is the shared source for categories, sizes, conditions,
listing types, clubs, limits, and public-field search behavior. Posting and browse
controls must use the same choices. Sizes include One size and Mixed sizes.
Clubs are an array, describing the gear; Other has a separate custom name.
Keep its input visible, typing checks Other, checking requires a name, and
unchecking clears it. Search includes custom names; the Other filter selects
all custom-club records. Prices are integer cents; a maximum-price filter includes
Free at zero and excludes unpriced trades. Server content validation is implemented in `lib/gear-validation.mjs`;
identity verification and authorization remain to be built.

At launch, homepage cards: Find Some Gear, Find Ice Time, Find A Coach.
Links: Browse Gear, View Ice Time Calendar, Browse Coach Profiles.
Preserve the current homepage/coaches colors and typography. Do not restore the
removed seller label, contact filler, or pickup explanatory paragraph.

## Claude review disposition

The September 25 design review concluded ready after design fixes. It inspected
source, not a rendered browser, and could not read the accompanying design brief.

Accepted design fixes: consistent city/size/club filters; trade wishes on detail;
mobile price/contact placement and collapsible filters; seller deletion;
accessible form grouping, focus, readable text, autocomplete, and validation.
Use one through six real photos dynamically, including the zero-photo state.
Escape all user text in HTML/email; prototype static-string rendering must not
be carried over to real listing data.

Photo metadata removal, abuse controls, token security, moderation, read-time
expiry, retention, and record/photo restoration were already requirements.
They remain launch gates, not evidence of a current production leak: the
prototype uploads nothing. The color mismatch finding is rejected: current
homepage and coaches use the prototype's charcoal/mustard variants. The technical
spec's generic color table differs from those pages. Approved home copy/order
stands. The unrelated Groups binding-error finding is outside this increment.

## Implementation sequence

1. Shared field/search contract and focused tests — complete.
2. Repo-based preview screens and design fixes — complete as a simulation.
   Keep unfinished pages unlinked and noindex until launch.
3. Specify D1 schema, ownership/state transitions and migrations; implement local
   persistence and server validation. Partly complete: the schema, local
   persistence and validation are implemented; ownership and state-transition
   design are documented for local verification and management; remote integration remains. No production resources in this step.
4. Local per-listing verification and management are implemented. Remote integration requirements:
   scanner-safe GET plus explicit POST actions,
   hashed expiring tokens, revocation, safe cookies, CSRF/origin checks, generic
   recovery responses, changed-email verification, and idempotent transitions.
5. Private image pipeline, contact delivery, reporting and owner-authenticated
   moderation, with abuse limits and failure-path tests.
6. Retention/cleanup, restore rehearsal, policies, full integration checks,
   owner-mediated implementation review, then separately authorized launch.

## Operational requirements before launch

Approved service direction: D1 records, Cloudflare Images for Gear photos, Pages
Functions, Resend transactional mail, Cloudflare Access for owner moderation, a
dedicated scheduled maintenance Worker, and encrypted off-Cloudflare backup.
No Gear bindings, routes, credentials or resources have been provisioned.

- Validate/re-encode photos and remove metadata in a trusted pipeline before
  publication; client processing alone is insufficient. Draft images stay private.
- Enforce public-field allowlists and visibility on the server. Check expiry on
  reads; takedowns must promptly invalidate cached data. Removed listings cannot
  be renewed. Define closed/expired/deleted behavior explicitly.
- Rate-limit posting, verification, recovery, contacts and reports; use bot
  protection where appropriate. Never expose seller email publicly. Contact
  discloses sharing the buyer email; direct seller replies reveal seller email.
- Separate test and production databases/buckets/credentials. Default tests to
  a mail sink; real staging delivery requires explicit allowlisted recipients.
  Missing mail configuration must not falsely report successful delivery.
- Define additive migration order and rollback separately from Pages deployment.
  Do not add a root Worker configuration that takes over existing Pages behavior.
  Scheduled cleanup requires its own documented deployment boundary.
- Specify retention for drafts, originals, messages, tokens, logs and deleted
  listings before collecting real data. Add seller deletion and authenticated
  owner removal with a usable report queue/runbook. Define recover/revoke scope.
- Document and test restore coverage for D1 and R2; existing Groups backups do
  not cover this feature. Set privacy/prohibited-item copy and protective-gear
  disclosures before launch. Adult-use enforcement and final search-indexing
  policy must be resolved in the UI/launch increment.

Preview screens live in `gear/index.html`, `gear/gear.css`, and `gear/gear.mjs`.
Under ordinary static hosting, listings, management access, verification and
contact actions are simulated; inputs and photos reset on reload. The opt-in
local server persists listings and management photos (see `gear-photos.md`).
The static public sample dataset is separate from seller drafts. Production
uploads, authentication, delivery, automatic expiry cleanup and deletion
retention remain unimplemented; the separate storage query already enforces expiry on reads.

Review fixes: new-listing navigation resets prior edits and pending verification;
drafts store integer cents and clear inactive offer fields. Price formatting,
field limits, focus, photo labels and no-photo states are shared/consistent.
Closed listings may be explicitly relisted for 30 days; expired listings may be
renewed, subject to the active limit. Deleted preview records cannot be renewed.
Both browser modules have explicit JavaScript MIME/no-cache rules (the gear
module inherits no-cache from /gear/*). Actual Pages headers remain a deployment
check; no production deployment is authorized by this edit.

Local persistence increment: see [gear-storage.md](gear-storage.md) for the
schema, local-only API, validation, tests and local D1 evidence; remote D1 remains untested.

September 26 review follow-up: upgrade tests now cover the original version-1
database and an existing version-3 database with the old unverified-draft index
and publication trigger. Failed-repair tests reopen read-only and compare full
listing rows to prove rollback; publication is also tested at exact expiry.
The verification increment passed 30 tests and was committed as `c2acb18`.
Current management work and checks are recorded in Resume here and
`gear-management.md`; this paragraph is historical verification context.
