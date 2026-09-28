# Local Gear deletion, cleanup and restore

Status: local sample-data implementation, September 28, 2026. Review baseline
`9836ff7` plus this lifecycle increment. No production service, scheduled
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
Until explicit cleanup runs, local owner text can remain after the deadline;
automated enforcement is required before launch. POST `/management/deletion` requires the
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
physical database cleanup requires an explicit offline command. There is no
scheduled cleanup yet. Stop the local server before every command below and
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
retention policy is not yet finalized. In-memory mail/contact inspection queues
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
contained deletion deadline, whichever comes first. Re-backing up a marked
snapshot is rejected. Prune previews recognized expired snapshots; `--apply`
deletes those files. Invalid, unreadable and unrecognized files are skipped,
so separately copied/corrupt files require manual inventory and retention.
No automatic pruning is configured.

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

This is a tested local restore rehearsal, not disaster recovery when the latest
working database/ledger is lost. That case remains a launch gate. Cloud D1/R2,
mail delivery, owner keys, certificates, memory queues and external backups are
outside snapshot coverage. Stop the server to avoid races between reconciliation
and source changes; these tools do not enforce an exclusive process lock.

## Verification and next boundary

Eight lifecycle tests cover ownership/CSRF/Origin, repeat actions, exact recovery
boundaries, email transfer, expiry/duplicate rules, moderation separation,
transaction rollback, purge scope, record/photo restore, credential revocation,
file overwrite refusal, retention and snapshot pruning. The full Gear suite has
88 tests. Connected Chrome checks cover delete, hidden photo URLs, reload and
recovery at desktop/mobile widths; the owner harness also passes.

Owner-mediated Claude review and the confirmed accessibility fix are complete;
the owner authorized the local commit. Remaining launch work includes production
services/integration, real mail and owner identity, broader draft/token/log
retention and abuse controls, remote record/photo disaster recovery, scheduled
cleanup, policy/adult-use copy and final integration/launch review. Deployment
requires full completion and explicit owner authorization.

Claude review approved the local-only package with zero blocker/high/medium
findings and one low accessibility finding. Failed delete requests now close the
dialog before the shared error receives focus. A routed-409 Chrome regression
checks desktop/mobile focus, visible error, unchanged data and successful retry.
