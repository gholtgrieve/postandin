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

### Production moderation actions — current, uncommitted

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

The next bounded increment after review should add the production seller-deletion
marker and enforce it during owner restore before connecting the production owner
UI or provisioning the admin hostname, Access values and D1 binding. Seller
deletion/recovery, production photos/mail, scheduled cleanup/failure
notifications and remote disaster recovery remain launch requirements.

No push/deployment.

### Checks and local commands

Run from the canonical checkout:

```bash
git status --short
git branch --show-current
# Photo tests require macOS with /usr/bin/sips.
node --test tests/gearAccess.test.mjs tests/gearLifecycle.test.mjs tests/gearModeration.test.mjs tests/gearReports.test.mjs tests/gearContact.test.mjs tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs tests/gearMaintenance.test.mjs tests/gearPagesListings.test.mjs tests/gearPagesModeration.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearPagesReportSubmission.test.mjs tests/gearProductionFoundation.test.mjs
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
production photo storage remains future work.

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
