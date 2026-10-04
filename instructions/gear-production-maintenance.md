# Gear Exchange production scheduled maintenance

Status: owner-authorized production deployment completed on 2026-10-03.
Migrations 0001–0018 are applied to the production Gear D1 database. The Images
binding, dedicated maintenance-state KV namespace, Resend secret, alert recipient,
Worker and 11:00 UTC Cron Trigger are provisioned. The checked-in
`gear-maintenance/wrangler.toml.example` deliberately remains free of production
identifiers and secrets.

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
3. Removes expired/consumed management links and transfers; revoked/expired
   sessions; and verification tokens after expiry unless their unverified draft
   remains inside its three-day lifetime. That live-draft token row retains the
   durable five-message delivery count until draft deletion cascades it. Consumed
   verification rows remain through token expiry for lost-response confirmation.
   The pass also removes reports and moderation history at 30 days and purge
   ledger rows 30 days after the original purge. Active removal enforcement remains, while its free-text
   reason becomes fixed generic text after 30 days. Sellers are removed only after
   their last listing and dependent credentials are gone. The same bounded record
   pass stages and consumes expired unclaimed quarantines, claimed rows only after
   both their upload TTL and five-minute lease have expired, and every retained
   sanitized-conflict row. Both provider IDs are
   durably queued before such a row is removed. The same retention batch removes
   seller photo-upload counters due at their UTC-day boundary, hashed buyer-contact
   attempts due after ten minutes and private contact delivery copies due after
   24 hours. The scheduled pass means physical deletion can occur up to one cron
   interval after a row becomes due.
4. Lists private hosted objects by the exact `gear-photo-quarantine` and
   `gear-photo` metadata purposes. Objects at least 24 hours old are queued only
   when D1 has no matching quarantine, retained sanitized-conflict row, or attached
   photo reference. A second atomic reference guard closes the list/write race;
   objects uploaded before any D1 write are protected by the 24-hour grace period.
   Listing is capped at ten 100-object pages per purpose per attempt. The next
   opaque cursor is tracked after every page, so reaching the cap is normal progress
   and the next attempt resumes instead of alerting or restarting from the oldest
   object. Progress is coalesced to one maintenance-KV write per attempt, only when
   it changed. Completing a purpose clears its cursor; a rejected saved cursor is
   cleared and retried once from the beginning.
5. Deletes queued objects through `IMAGES.hosted.image(id).delete()`. Both `true`
   (deleted) and `false` (already absent) are success, making retries idempotent.
   Failure increments an attempt count and timestamp but retains the outbox row;
   no provider ID or private record value is logged or emailed. After record
   cleanup, the Worker uses its remaining operation budget to drain newly staged
   IDs. A remaining full queue fails with a bounded-backlog code.

The outbox deliberately has no listing foreign key. It survives the D1 cascade
and is retained without a time limit until the hosted object is confirmed absent.
Migration 12 permits a null `listing_id` for provider-discovered orphans, where no
truthful listing context remains. The deletion drain excludes every provider ID
currently referenced by an attached photo, quarantine original, or retained
sanitized-conflict row; retention pruning removes such stale queue entries without
calling Images. Migration 11 quarantine rows likewise survive listing purge so
the scheduled pass can stage remote cleanup before consuming them.

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
an episode-derived idempotency key. Recovery-alert or failure-episode KV failure
does not rerun a successful cleanup. Cursor-progress KV failure triggers the
one-minute idempotent retry so a large sweep cannot silently stop advancing.
Worker logs use generic failure codes; inspect
Cloudflare's invocation/binding diagnostics for service-level detail.

Unreadable or malformed reconciliation cursor state is treated as empty so it
cannot block due record deletion or outbox draining. If an incident requires a
manual restart of the provider sweep, delete only the
`gear-photo-reconciliation-cursors-v1` key from the dedicated maintenance KV;
do not delete the separate failure episode key or any D1 row.

The Worker requests server-side metadata filtering for each purpose and then
revalidates every returned object's ID, privacy, draft state, purpose, source and
upload time. Cleanup safety does not depend on the provider applying that filter;
the local workerd binding currently ignores it, and the populated-binding harness
therefore exercises the client-side guard.

## Production deployment record

The owner-authorized deployment binds production D1 as `GEAR_DB`, paid Images as
`IMAGES` and dedicated KV as `GEAR_MAINTENANCE_STATE`; it stores the Resend key
and alert recipient as Worker secrets. `workers_dev` and preview URLs remain
disabled. The deployed Cron Trigger is 11:00 UTC daily. Keep production resource
identifiers and secret values out of Git. Future binding, secret, migration or
schedule changes require the consolidated review and rollback sequence in
[gear-launch-runbook.md](gear-launch-runbook.md). Never point local tests at an
owner database.

Cloudflare references used for this design:
[scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
and [hosted Images binding listing/deletion](https://developers.cloudflare.com/images/storage/binding/).

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
generic provider failures, quarantine expiry/lease/conflict reconciliation,
24-hour hosted-orphan grace, live-reference races, malformed/bounded listing,
persisted cursor resume, 100-object D1 reference checks and populated local Images listing,
migration upgrade and the D1 cleanup path. No remote
resource or real message is used.
