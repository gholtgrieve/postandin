# Gear Exchange implementation plan

Status: development preview, September 25, 2026. `/gear/` is an unlinked,
noindex design preview. A local-only draft-storage API now exists separately;
there is no deployed API, cloud storage, email service or homepage link. The external prototype
is a design reference, not production code.

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

1. Shared field/search contract and focused tests — implemented in this increment.
2. Repo-based browse/post/detail design using that contract, including mobile and
   accessibility fixes, deletion confirmation, and trade details. Keep unfinished
   pages unlinked and noindex; verify routing before introducing routes.
3. Specify D1 schema, ownership/state transitions and migrations; implement local
   persistence and server validation. Partly complete: the schema, local
   persistence and validation are implemented; ownership and state-transition
   design remain for the next increment. No production resources in this step.
4. Verification and management: scanner-safe GET plus explicit POST actions,
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

## Review this increment

Review `git diff main...HEAD` plus `git diff` and all untracked files shown by
`git status --short`; the preview was committed as 7b85550; review local storage changes against that preview commit. Inspect the shared module and
its tests, this plan, README and the technical-spec entry. Check that planned
security and infrastructure are not described as implemented. Do not commit,
push, deploy, contact users, or use live credentials. Run the focused Node test
and syntax check, then report concrete findings and test gaps.

Preview screens live in `gear/index.html`, `gear/gear.css`, and `gear/gear.mjs`.
All sample listings, management access, verification and contact actions are
simulated. Inputs and local photos remain in memory and reset on reload.
The public sample dataset is separate from seller drafts. Real uploads,
authentication, delivery, expiration and deletion retention remain unimplemented.

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
