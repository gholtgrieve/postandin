# Gear Exchange production moderation read foundation

Status: source-only and not deployed. No migration was applied remotely, no D1
binding or Access policy was configured, and no production data was read or
changed. This increment adds no public submission or moderation write route.

## Storage boundary

Migration `0008_moderation.sql` adds three production tables whose names are
separate from the existing `gear_local_*` preview tables:

- `gear_reports` stores a generated report ID, listing ID, title snapshot, one
  supported shared reason, millisecond creation time and resolution.
- `gear_removals` reserves the current removal state: listing ID, prior public
  status, removal time and bounded owner reason.
- `gear_moderation_history` reserves bounded audit fields for a future owner
  action, including actor, action, listing/report context, before/after status
  and millisecond creation time.

The migration creates no trigger or route that writes these tables. Reports and
active removals retain listing foreign keys: future permanent purge must delete
those dependent records before deleting a listing. `gear_reports.listing_id` is
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
server-side. The route performs no write.

Merging the source alone does not make the route usable: on ordinary Pages hosts
the Access verifier denies it, and the dedicated admin hostname, Access policy,
environment values, migration and D1 binding remain separately authorized
deployment work.

## Verification

```bash
node --test tests/gearPagesModeration.test.mjs tests/gearAccess.test.mjs tests/gearProductionFoundation.test.mjs tests/gearPagesListings.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --check lib/gear-moderation-storage.mjs
node --check functions/api/gear/admin/reports.js
node --check tests/gearPagesModeration.test.mjs
git diff --check
```

Focused Node tests cover migration constraints, open-only ordering and the
100-row cap/truncation signal, the exact private-field exclusion,
Access-before-binding/D1 execution including the real handler wiring, response
headers, missing configuration/binding and safe query failure. The
eight-migration D1 harness passes on Wrangler 4.107.0, Miniflare 4.20260701.0
and workerd 1.20260701.1, including an actual D1 moderation insert/read,
the listing index and 101-row truncation signal, idempotent migration ledger,
populated version-6 upgrade and persistence after workerd restart. All databases
and identities used by tests are temporary and fictitious.
