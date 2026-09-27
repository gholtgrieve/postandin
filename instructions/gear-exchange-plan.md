# Gear Exchange implementation plan

Status: development preview, September 26, 2026. `/gear/` is an unlinked,
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

These commits were created locally. No push, merge, production migration or
provisioning was performed during this work. The documentation handoff is maintained in subsequent documentation commits;
inspect `git status` and recent history before continuing.

### What actually works

| Component | Implemented | Not implemented |
|---|---|---|
| `/gear/` preview | Five screens, sample browsing, posting, local photo previews, simulated management | Persistent UI data, real verification/email, live publishing |
| Shared modules | Options, public search, price formatting, server content validation | Identity or authorization checks |
| Local storage | SQLite persistence through a D1-shaped adapter; atomic seller/listing/club inserts | Tested D1/workerd binding or production deployment |
| Local API | Drafts, token confirmation, public projection, local authenticated management | Any Pages route, real mail, browser integration |
| Public query | Explicit public fields, listing/seller verification checks, status and read-time expiry | Deployed publication endpoint, pagination, search API, cleanup job |

The preview's managed records and public samples are separate arrays. They are
also separate from the local database. Do not mistake simulated verification,
renewal or deletion for backend behavior. `readLocalDraft` exposes private sample
email for trusted local inspection and must never become an unauthenticated
Pages handler. All timestamps use milliseconds.

### Current increment: verified email changes

Local seller management is committed as `06be078`. This increment
adds separately verified mailbox transfers, without renaming seller rows.
See [gear-email-change.md](gear-email-change.md) for exact transfer semantics,
local routes, failure behavior and tests. All 49 focused tests pass locally;
Claude review concluded ready to merge for this local-only increment, with no
blocker/high/medium defects. Small test/documentation follow-ups passed all 49
tests but were not separately re-reviewed. This increment is included in the
verified email-change commit; use Git history for its hash. Nothing is pushed,
merged or deployed.

### Next bounded task

Implement and test
CSRF recovery after page reload and the HTTPS browser session flow. Actual
D1/workerd validation must precede remote integration; local SQLite alone is
not evidence of deployed behavior. Keep the preview separate until these checks
are complete. Seller deletion, retention and restore remain separate work.

UI integration must map offer labels to lowercase, `seller` to `sellerName`, and
include adult acknowledgement on new drafts. Never expose local draft inspection
or simulated mailboxes on Pages. No real delivery or deployment is authorized.

### Checks and local commands

Run from the canonical checkout:

```bash
git status --short
git branch --show-current
node --test tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs
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

Remaining low-priority preview notes: sample sorting still uses its legacy
dollar field; focus after some management/photo rerenders can be improved;
`offerFields` assumes validated browser input. Production storage uses
`validateDraft`, not that preview helper. Address these when integrating the UI.

Remaining integration/launch checks: actual D1 batch/SQL behavior, deployed
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

For the current email-change review, compare against `06be078` (plus untracked
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

Proposed services: D1 records, R2 images, Pages Functions, Resend transactional
mail. These are proposals; no bindings or accounts have been provisioned.

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
All sample listings, management access, verification and contact actions are
simulated. Inputs and local photos remain in memory and reset on reload.
The public sample dataset is separate from seller drafts. Real uploads,
authentication, delivery, automatic expiry cleanup and deletion retention remain
unimplemented; the separate storage query already enforces expiry on reads.

Review fixes: new-listing navigation resets prior edits and pending verification;
drafts store integer cents and clear inactive offer fields. Price formatting,
field limits, focus, photo labels and no-photo states are shared/consistent.
Closed listings may be explicitly relisted for 30 days; expired listings may be
renewed, subject to the active limit. Deleted preview records cannot be renewed.
Both browser modules have explicit JavaScript MIME/no-cache rules (the gear
module inherits no-cache from /gear/*). Actual Pages headers remain a deployment
check; no production deployment is authorized by this edit.

Local persistence increment: see [gear-storage.md](gear-storage.md) for the
schema, local-only API, validation, tests and remaining D1 runtime check.

September 26 review follow-up: upgrade tests now cover the original version-1
database and an existing version-3 database with the old unverified-draft index
and publication trigger. Failed-repair tests reopen read-only and compare full
listing rows to prove rollback; publication is also tested at exact expiry.
The verification increment passed 30 tests and was committed as `c2acb18`.
Current management work and checks are recorded in Resume here and
`gear-management.md`; this paragraph is historical verification context.
