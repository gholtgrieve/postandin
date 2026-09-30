# Gear Exchange production scheduled maintenance

Status: source-only and not deployed. Migration 10 has not been applied remotely.
No Gear D1 database, Images binding, maintenance-state KV namespace, Resend secret,
alert recipient, Cron Trigger or Worker has been provisioned. The checked-in
`gear-maintenance/wrangler.toml.example` is intentionally not deployable until an
owner-authorized setup replaces its commented placeholders.

## What the daily run does

The scheduled-only Worker has no `fetch` handler and is separate from the existing
schedule/RSVP Worker. Its proposed cron is 11:00 UTC daily (about 4am PDT / 3am
PST). The scheduled handler registers one promise so Cloudflare records a failed
invocation when maintenance or alerting cannot complete.

Each run validates D1, hosted Images, dedicated state KV, Resend key and alert
recipient before making any cleanup write. It then works within one shared
900-D1-operation and 13-minute invocation budget:

1. Drains up to two 40-object hosted-image pages before record cleanup, so a
   record backlog cannot starve previously queued private-image deletion. Failed
   rows move behind untouched work on later pages.
2. Finds at most 40 due seller deletions and 40 three-day unverified drafts in
   one record page per attempt. In one transactional D1 batch per listing, copies every private hosted-image
   provider ID into `gear_photo_deletions`, removes listing-bound reports,
   moderation state/history and the listing, and stamps the minimal deletion
   ledger when applicable. Every statement rechecks the due marker or draft state,
   so seller recovery or verification winning the race leaves all content intact.
3. Removes expired/consumed links, tokens and transfers; revoked/expired sessions;
   reports and moderation history at 30 days; and purge ledger rows 30 days after
   the original purge. Active removal enforcement remains, while its free-text
   reason becomes fixed generic text after 30 days. Sellers are removed only after
   their last listing and dependent credentials are gone.
4. Deletes queued objects through `IMAGES.hosted.image(id).delete()`. Both `true`
   (deleted) and `false` (already absent) are success, making retries idempotent.
   Failure increments an attempt count and timestamp but retains the outbox row;
   no provider ID or private record value is logged or emailed. After record
   cleanup, the Worker uses its remaining operation budget to drain newly staged
   IDs. A remaining full queue fails with a bounded-backlog code.

The outbox deliberately has no listing foreign key. It survives the D1 cascade
and is retained without a time limit until the hosted object is confirmed absent.
Migration 11 photo-quarantine rows likewise survive listing purge, but the current
maintenance Worker does not process them yet. Before launch, reconciliation must
delete expired unclaimed or lease-expired quarantines, treat rows with a
`sanitized_provider_id` as cleanup targets, and sweep both
`purpose:gear-photo-quarantine` originals and unreferenced `purpose:gear-photo`
objects. Only sanitized provider IDs present in `gear_photos` are live.

## Retry and alerts

Invalid or missing configuration fails before cleanup without a retry because the
Worker cannot safely run or alert; fix deployment configuration first. After
configuration passes, the first failed run waits exactly one minute and tries the
complete idempotent maintenance pass again. Both attempts share the 900-operation
cap; each attempt can claim at most 440 D1 operations. Work stops accepting new
operations at 13 minutes, leaving time inside Cloudflare's 15-minute scheduled
handler limit to record the failure. Image calls wait at most four seconds and
stop when five minutes remain, reserving time for due record cleanup, retry state
and alerts. Every D1 call, including a fallback attempt update after an outbox
delete failure, consumes the budget. A second failure records a random
failure episode in a dedicated KV namespace, sends one generic owner alert through
Resend, and rejects the scheduled invocation. Repeated daily failures do not send
repeat mail. The first later successful run sends one recovery alert only if the
failure alert was recorded as delivered, then removes the episode state. No
healthy-run message is sent.

Alert messages contain only the event time and fixed operational guidance. They
contain no listing, seller, recipient, token, provider ID, request body or database
error. The Resend request uses manual redirect handling, a ten-second timeout and
an episode-derived idempotency key. Recovery-alert or KV failure does not rerun a
successful cleanup. Worker logs use generic failure codes; inspect
Cloudflare's invocation/binding diagnostics for service-level detail.

## Deployment boundary

Do not copy the example to `wrangler.toml`, create resources, set secrets, apply
migration 10 remotely, or deploy until the full Gear project is complete and the
owner explicitly authorizes deployment. At that time, in a separately reviewed
runbook:

- create/identify the production Gear D1 database and apply all migrations in
  order with a verified backup and rollback plan;
- bind that database as `GEAR_DB`, the existing paid Images account as `IMAGES`,
  and a dedicated KV namespace as `GEAR_MAINTENANCE_STATE`;
- set `GEAR_RESEND_API_KEY` and `GEAR_ALERT_RECIPIENT` with `wrangler secret put`;
- copy and complete the example config, retain `workers_dev=false` and
  `preview_urls=false`, deploy manually from `gear-maintenance/`, and verify the
  Cron Trigger and persisted logs;
- test the scheduled handler first against isolated staging resources with mocked
  or allowlisted mail and disposable private images. Never point local tests at an
  owner database.

Cloudflare references used for this design:
[scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
and [hosted Images binding deletion](https://developers.cloudflare.com/images/storage/binding/).

## Verification

```bash
node --test tests/gearProductionMaintenance.test.mjs tests/gearMaintenance.test.mjs tests/gearLifecycle.test.mjs tests/gearPagesSellerDeletion.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
git diff --check
```

Tests use temporary sample databases, fake Images bindings, in-memory KV and
mocked Resend fetches. They cover outbox-before-cascade, exact deadlines, race
loss, rollback, missing-image idempotency, retained failed work and poison-row
rotation, bounded operation/time budgets, pre/post-record image paging, retry timing, alert
deduplication/recovery and recovery-alert isolation, configuration failure before cleanup,
generic provider failures, migration upgrade and the D1 cleanup path. No remote
resource or real message is used.
