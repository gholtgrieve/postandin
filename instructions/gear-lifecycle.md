# Local Gear deletion, cleanup and restore

Status: local sample-data implementation, September 28, 2026. Review baseline
`9836ff7` plus this lifecycle increment. No production service, production scheduled
job, push or deployment. Owner approved immediate hiding, 30-day recovery, then
permanent cleanup.

## Seller behavior and authorization

Connected management offers Delete and Recently deleted. Deletion hides the
listing from browse and normal management and denies its public, seller and
owner photo URLs immediately. An authenticated seller sees only their deleted
listing IDs, titles and deadlines. The owner-approved moderation policy retains
listing text associated with reports or removals for authenticated owner review
during recovery; photos remain hidden. The deletion notice explains this.
Permanent cleanup removes the listing and associated persisted moderation text.
Until the next cleanup, local owner text can remain after the deadline (normally
up to one extra day while the server is running). POST `/management/deletion` requires the
existing seller cookie, matching Origin and CSRF; actions are `delete` and
`restore`. GET `/management/deleted` requires the seller cookie.

Recovery is allowed strictly before deletion time plus 30 days and follows
current ownership after a verified email transfer. It preserves the original
expiry, restores elapsed active listings as expired, and rechecks verification,
duplicates and active quota before republication. A previously moderated listing
stays removed. Owner restore cannot bypass seller deletion. Repeated deletion
cannot extend an existing recovery window. Ordinary static hosting remains a
simulation.

## Local storage and permanent cleanup

Additive local-only tables `gear_local_deletions` and
`gear_local_deletion_ledger` hold recovery state. At the deadline recovery stops;
physical database cleanup now runs automatically on server listen and daily
while it runs. Failures emit a generic console error and retry after one minute.
Success is silent; closing the server cancels the timer. A stopped local server
cannot run cleanup; restart catches up. Optional manual inspection remains
available. Stop the local server before every command below and
use only a dedicated sample database outside the checkout. Commands use Node's
SQLite support, already used by the local server; no dependency was added.

```bash
node scripts/gear/local-cleanup.mjs /absolute/sample/gear.sqlite
node scripts/gear/local-cleanup.mjs /absolute/sample/gear.sqlite --apply
```

The first command previews due listing counts. Opening the database can perform
existing additive initialization and expiry maintenance; preview is not a
byte-for-byte read-only operation. `--apply` atomically deletes due listings,
photo blobs, clubs, verification tokens, associated persisted reports, removal
records and moderation history. Sellers with no remaining listings and their
management credentials/pending transfers are removed. A minimal listing-ID and
deletion/purge-time ledger remains to prevent later snapshot resurrection; its
retention is 30 days after permanent purge. In-memory mail/contact inspection queues
are not database content; stopping the server clears them.

SQL deletion is logical record removal, not certified erasure of filesystem
blocks, Dropbox history or separately copied files. No existing user database
has been purged during implementation; destructive checks use temporary fixtures.

## Snapshot and restore rehearsal

Use a dedicated private snapshot directory outside the checkout. Output files
are exclusively created with mode 0600; existing files are never overwritten.
Snapshots are not encrypted. Do not put real personal data in these samples.

```bash
node scripts/gear/local-backup.mjs backup /absolute/sample/gear.sqlite /absolute/snapshots/gear.sqlite
node scripts/gear/local-backup.mjs restore /absolute/snapshots/gear.sqlite /absolute/sample/restored.sqlite /absolute/sample/gear.sqlite
node scripts/gear/local-backup.mjs prune /absolute/snapshots
node scripts/gear/local-backup.mjs prune /absolute/snapshots --apply
```

SQLite backup captures database records and local photo blobs, with integrity
and foreign-key checks. Due deletions are purged from the copy. The source is
unchanged. Snapshot metadata expires after at most 30 days, or at the earliest
contained deletion, draft, report/history, removal-reason or ledger deadline,
whichever comes first. Credential rows are excluded from new snapshots. Re-backing up a marked
snapshot is rejected. Prune previews recognized expired snapshots; `--apply`
deletes those files. Invalid, unreadable and unrecognized files are skipped,
so separately copied/corrupt files require manual inventory and retention.
Set `GEAR_BACKUP_DIRECTORY=/absolute/snapshots` when starting the local server
to prune that dedicated directory on each automatic cleanup run. No directory
is scanned by default. This deletes only recognized expired snapshots and never
creates backups. Startup and daily pruning share the one-minute retry policy.
Corrupt/unrecognized files are skipped by the existing prune tool; inventory
and recovery of such files remains an operator task.

Restore creates a new database for inspection; it never promotes or overwrites
the current one. It requires an unexpired generated snapshot AND the actual
current working database from the same dataset. The operator must supply the
correct pair: database lineage is not automatically proven. Current owner
removals and deletion ledger entries are reconciled, and purged/overdue listings
are removed so an older snapshot cannot undo those current restrictions.
All restored seller sessions, management links, pending email transfers and
verification tokens are discarded. Obtain fresh local management access.
Older snapshot restrictions may remain conservatively in place even if later
recovered; this is not a merge of every subsequent edit or moderation action.

This is the local snapshot restore path. Loss of the latest working D1 records is
covered separately by the encrypted off-provider backup and tested restore in
`gear-lean-backup.md`; that recovery deliberately excludes photos, credentials,
contact messages, reports, and short-lived state, so sellers must upload photos
again after a total media loss. Mail delivery, owner keys, certificates, and
memory queues remain outside snapshot coverage. Stop the server to avoid races
between reconciliation and source changes; these tools do not enforce an
exclusive process lock.

## Verification and next boundary

Lifecycle tests cover ownership/CSRF/Origin, repeat actions, exact recovery
boundaries, email transfer, expiry/duplicate rules, moderation separation,
transaction rollback, purge scope, record/photo restore, credential revocation,
file overwrite refusal, retention and snapshot pruning. The full Gear suite has
97 tests. Connected Chrome checks cover delete, hidden photo URLs, reload and
recovery at desktop/mobile widths; the owner harness also passes.

Owner-mediated Claude review and the confirmed accessibility fix are complete;
the owner authorized the local commit. Remaining launch work includes production
services/integration, real mail and owner identity, production retention/log
controls and abuse controls, remote record/photo disaster recovery, scheduled
cleanup, policy/adult-use copy and final integration/launch review. Deployment
requires full completion and explicit owner authorization.

Claude review approved the local-only package with zero blocker/high/medium
findings and one low accessibility finding. Failed delete requests now close the
dialog before the shared error receives focus. A routed-409 Chrome regression
checks desktop/mobile focus, visible error, unchanged data and successful retry.


## Short retention policy and automation (baseline 87c1805)

Owner-approved periods: unverified drafts 3 days from creation; contact copies
become due after 24 hours; reports and moderation history 30 days from creation;
invalid credentials at next cleanup; deletion ledger 30 days after first purge.
The 30-day seller recovery window remains unchanged. Verified expired/closed
listings are not automatically deleted by this increment.

Cleanup retains expired unconsumed verification rows for live drafts so their
delivery cap cannot reset, and retains consumed verification rows through token
expiry for lost-response confirmation. Draft deletion cascades the former.
Cleanup removes expired/consumed management links, expired or
revoked sessions, and expired/consumed transfers or transfers tied to an invalid
session. Transfer rows are removed before their referenced sessions. It preserves
other listings and sellers still owning any listing, including recovering ones.
Active owner-removal IDs/prior state/time remain to enforce removal; free-text
reasons older than 30 days become a generic marker. Cleanup never republishes a
listing or extends a deadline. Draft/credential/history deletion is transactional
with listing purges. Preview reports candidate counts, not a sum of cascaded rows.

Contact and memory-report getters prune expired entries, and the scheduled run
also clears them during idle periods. Queues can evict earlier at their existing
20-entry bound or server shutdown. Custom delivery sinks own their retention;
this policy covers the built-in sample inbox. Production contact copies are
removed by the next daily maintenance pass after their exact due time, so
physical deletion can occur up to one schedule interval later. Production mail
remains fail-closed until the reviewed go-live deploy.

New snapshots enforce the earliest retained-content deadline and contain no
credentials. Restore applies cleanup again, preserves original purge timestamps,
and avoids copying expired removal reasons into new history entries. Snapshots
made by older versions retain their original expiry metadata; retire those copies
when adopting this policy. Do not hand-edit metadata or restore from stale clones.

Local automation is not an OS background job: it runs only while this server is
listening. The separate production Worker documented in
`gear-production-maintenance.md` has its bindings, cron, secret, and alerts
deployed. The encrypted records-only backup is scheduled separately as described
in `gear-lean-backup.md`; no private request bodies are added to cleanup logs.
Filesystem/Dropbox history erasure is outside this tool.

Package verification covers maintenance startup/retry/cancellation, automatic
snapshot pruning, exact retention boundaries, and transactional rollback. The
HTTPS Chrome harnesses cover adult contact consent and expanded rules at
1040/390/320 widths.


Review fixes: restore reconciliation history always uses fixed generic text,
never copying a moderator's free-text reason into a row with a new timestamp.
Invalid `GEAR_BACKUP_DIRECTORY` fails before server construction or cleanup with
a specific configuration error. Paths must name an existing directory outside
the checkout. Runtime failures still retry; correct startup configuration first.

On the first launch after adopting this package, retention applies immediately
and permanently deletes due sample data. Use the offline preview command before
launch if inspecting an existing sample database. No owner database was launched
or cleaned during implementation. All 97 tests pass after fixes; browser checks
passed before these backend-only fixes. The owner authorized the local commit.
