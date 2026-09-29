# Gear Exchange production seller-deletion foundation

Status: source-only and not deployed. Migration 9 has not been applied remotely,
no seller lifecycle route writes these tables, and no production record was read
or changed. This increment establishes the durable deletion state needed before
the owner moderation routes can be provisioned safely.

## Storage boundary

Migration `0009_seller_deletions.sql` adds:

- `gear_deletions`, the active 30-day recovery marker for a listing. It stores
  only listing ID, prior status, deletion time and purge deadline. Its listing
  foreign key cascades when later permanent cleanup removes the listing.
- `gear_deletion_ledger`, the minimal anti-resurrection record. It stores listing
  ID and deletion/purge times plus an optional actual purge time. It deliberately
  has no listing foreign key so later cleanup and disaster recovery can retain it
  for the separately approved post-purge retention window.

The schema constrains prior status and requires non-negative integer timestamps,
a purge deadline strictly after deletion, and an actual purge time no earlier
than the deadline. Due-time indexes support future cleanup without adding a
scheduler or cleanup implementation here.

## Required seller-write contract

The next authenticated production lifecycle increment must preserve the local
transaction boundary:

- Delete atomically inserts both the active marker and its ledger row, then
  changes the listing status to `removed`. The ledger is created at
  deletion time, not deferred until permanent purge.
- Recovery is allowed only before `purge_at`. It atomically restores the eligible
  prior status and removes both the active marker and its still-unpurged ledger
  row. Removing the marker is essential: leaving it behind would let later
  cleanup or restore reconciliation purge a recovered listing.
- Permanent cleanup marks the ledger as purged while deleting the listing and
  its active marker. The ledger then remains for the approved post-purge
  retention window.

Owner restoration depends only on the active marker, not the ledger. This keeps
owner moderation independent after successful seller recovery while allowing
the later backup reconciliation path to treat retained purge evidence
conservatively.

## Owner restore guard

Production owner restore now requires that no matching row exists in
`gear_deletions`. A seller-deleted listing therefore stays removed even when it
also has a moderation removal. The failed owner action writes no history, expires
no stale duplicate and leaves both the deletion and moderation state unchanged.
Future authenticated seller recovery must remove the active deletion marker
before owner restoration can be considered independently.

This increment does not add seller authentication, deletion/recovery endpoints,
permanent purge, remote retention cleanup or backup reconciliation. Because the
ledger is stored in the same D1 database, restoring an older D1 copy also restores
an older ledger. The future disaster-recovery procedure must reconcile the
candidate restore against deletion evidence exported after that backup or kept
outside that D1 database; the restored ledger alone cannot prevent snapshot
resurrection. Do not provision the admin hostname and Access configuration with
`GEAR_DB` until those lifecycle and cleanup paths are complete.

## Verification

```bash
node --test tests/gearProductionFoundation.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearVerification.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --check lib/gear-moderation-actions.mjs
git diff --check
```

Tests use only temporary databases and fictitious identities. They cover schema
constraints and cascade in both SQLite and D1, independent ledger survival,
owner-restore denial after the recovery deadline with unchanged state and no
stale-duplicate cleanup, marker-only removal followed by eligible owner restore,
fresh and populated migration upgrades, persistence after workerd restart and the
existing moderation transaction behavior.
