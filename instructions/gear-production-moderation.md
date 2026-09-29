# Gear Exchange production moderation foundation

Status: source-only and not deployed. No migration was applied remotely, no D1
binding or Access policy was configured, and no production data was read or
changed. The public report route and owner routes remain disconnected from UI.

## Storage boundary

Migration `0008_moderation.sql` adds three production tables whose names are
separate from the existing `gear_local_*` preview tables:

- `gear_reports` stores a generated report ID, listing ID, title snapshot, one
  supported shared reason, millisecond creation time and resolution.
- `gear_removals` reserves the current removal state: listing ID, prior public
  status, removal time and bounded owner reason.
- `gear_moderation_history` stores bounded audit fields for an owner
  action, including actor, action, listing/report context, before/after status
  and millisecond creation time.

Reports and active removals retain listing foreign keys: future permanent purge
must delete those dependent records before deleting a listing.
`gear_reports.listing_id` is
indexed for those deletes and future per-listing report work. History
intentionally has no foreign keys so its bounded record may remain until its own
retention cleanup after a report or listing is purged. Remote 30-day
report/history cleanup and active-removal reason minimization are still required
before launch.

## Read route

`GET /api/gear/admin/reports` performs the existing Cloudflare Access JWT
verification before it checks for or reads the proposed `GEAR_DB` D1 binding.
Successful responses contain `{reports,truncated}`. `reports` contains at most
100 open reports, newest first with report ID as the deterministic tie-breaker;
`truncated` is true when older open reports remain outside that response. Each
report includes its saved title snapshot and current listing review fields.

The projection deliberately excludes seller email and internal seller ID,
duplicate keys, adult-acknowledgement evidence, management credentials and
Cloudflare Images provider IDs. The response is JSON with `no-store`,
`no-referrer` and `nosniff`. Authentication/configuration failures, a missing
binding and query failures use generic public errors; details are logged only
server-side. The read route performs no write.

## Action route

`POST /api/gear/admin/actions` requires the exact admin request URL and Origin,
rejects cross-site requests, accepts only JSON and reads at most 4 KiB. It then
verifies Cloudflare Access before inspecting the `GEAR_DB` binding or attempting
a write. The verified lower-case owner email becomes the history actor; the
request cannot choose an actor. Inputs are limited to a lower-case UUID, one of
`dismiss`, `remove` or `restore`, and a trimmed 1–500 character reason without
control characters. `id` is the report ID for dismiss/remove and the listing ID
for restore.

Each accepted action uses one D1 `batch`, which D1 executes as a transaction:

- dismiss records history and changes one open report to `dismissed` without
  changing its listing;
- remove requires one open report and a verified available/pending listing,
  records its prior state, changes it to `removed`, resolves the report and
  records history;
- restore requires an active removal and a still-verified, unexpired listing,
  rechecks the ten-active-listing quota and live duplicates, expires only stale
  duplicate rows, restores the prior available/pending state, removes the active
  removal row and records history. It never extends expiry.

Every write is gated on the history row created by that same batch. Invalid,
stale and replayed requests make no changes and return a generic conflict. A SQL,
constraint or audit-write failure rolls back the batch. The post-batch result
check is only a diagnostic alarm for a future broken invariant; D1 has already
committed when it runs. Public responses never contain the actor, report reason,
owner reason, SQL or exception details.

The source-only authenticated seller deletion/recovery transaction now writes the
migration-9 marker, and owner restore checks it so seller deletion cannot be
bypassed. Do not provision the admin hostname and Access values with `GEAR_DB`—
which would expose this action route even without an owner UI—until production
session issuance, retention cleanup and disaster recovery are complete.

Merging the source alone does not make the routes usable: on ordinary Pages hosts
the Access verifier denies it, and the dedicated admin hostname, Access policy,
environment values, migration and D1 binding remain separately authorized
deployment work.

## Verification

```bash
node --test tests/gearPagesModeration.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearAccess.test.mjs tests/gearProductionFoundation.test.mjs tests/gearPagesListings.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --check lib/gear-moderation-storage.mjs
node --check lib/gear-moderation-actions.mjs
node --check functions/api/gear/admin/reports.js
node --check functions/api/gear/admin/actions.js
node --check tests/gearPagesModerationActions.test.mjs
git diff --check
```

Focused Node tests cover migration constraints, open-only ordering and the
100-row cap/truncation signal, the exact private-field exclusion,
Access-before-binding/D1 execution including the real handler wiring, response
headers, missing configuration/binding and safe query failure. Focused action
tests cover all transitions, replay and eligibility conflicts, unchanged
expiry/report evidence, audit rollback, stale-duplicate rollback, exact Origin,
bounded/malformed JSON, Access-before-write behavior, verified actor selection,
generic failures and response headers. The nine-migration D1 harness passes on
Wrangler 4.107.0, Miniflare 4.20260701.0 and workerd 1.20260701.1, including
actual D1 dismiss/remove/restore and injected audit rollback as well as
moderation insert/read, the listing index and 101-row truncation signal, idempotent migration ledger,
populated version-6 upgrade and persistence after workerd restart. All databases
and identities used by tests are temporary and fictitious.
