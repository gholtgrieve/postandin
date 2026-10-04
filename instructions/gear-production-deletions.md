# Gear Exchange production seller deletion and recovery

Status: migration 0009 and the seller deletion/recovery route and UI are deployed
with production D1. Public listing creation remains fail-closed until the
reviewed go-live deploy, so production has no seller deletion marker or recovery
record. The credential issuer is
documented in `gear-production-management.md`.

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
than the deadline. Due-time indexes support the deployed cleanup scheduler.

## Seller-write contract

`POST /api/gear/management/deletion` now preserves the local transaction
boundary:

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

## Authentication and HTTP boundary

The route accepts only exact-origin JSON from `https://postandin.com`, rejects
cross-site requests, bounds the raw body to 1 KiB before fatal UTF-8 decoding and
requires exactly one production-only `__Host-gear_session` cookie plus the
derived `X-Gear-CSRF` value. The production issuer sets that cookie from
`postandin.com` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` and no
`Domain` attribute. The raw credentials are SHA-256 hashed before D1 access.
Every write rechecks the active, unrevoked session, its CSRF hash, its original
expiry and listing ownership inside the D1 batch; no client-supplied seller ID
survives validation.

Delete atomically records the original status in `gear_deletions`, creates the
ledger immediately and sets the listing to `removed`. This hides it from public
listing and report eligibility and prevents owner removal from treating it as a
currently public listing. Repeated or foreign deletion cannot extend the
deadline. Recovery is strictly before `purge_at`; it preserves an owner-moderated
`removed` state, restores elapsed listings as `expired`, and rechecks seller
verification, the ten-active-listing quota and live duplicates before restoring
an active state. Eligible stale duplicates expire in the same transaction.

Missing or malformed credentials, conflicts and internal failures return generic
no-store responses. The route does not issue or renew a session, set a cookie,
send mail or expose deletion records.

Application writes preserve a strict pairing invariant: every active
`gear_deletions` marker has one matching unpurged ledger row with identical
timestamps. Scheduled purge and backup-reconciliation work preserve that pair
until it atomically removes the listing/marker and stamps the ledger as purged.
Regression coverage includes owner-moderated `previous_status='removed'` records.
The deployed implementation and its coverage are documented in the
maintenance and lean-backup documents.

## Owner restore guard

Production owner restore now requires that no matching row exists in
`gear_deletions`. A seller-deleted listing therefore stays removed even when it
also has a moderation removal. The failed owner action writes no history, expires
no stale duplicate and leaves both the deletion and moderation state unchanged.
Authenticated seller recovery removes the active deletion marker
before owner restoration can be considered independently.

Permanent purge and remote retention cleanup are deployed through the scheduled
implementation in `gear-production-maintenance.md`. The off-provider backup and
restore process in `gear-lean-backup.md` reconciles fresh deletion evidence so an
older snapshot cannot resurrect a seller purge. Production session issuance and
mail integration are deployed behind the reviewed launch controls. The admin
hostname, Access policy, and `GEAR_DB` binding are deployed; the owner workspace
remains private, unlinked, and independently verifies Access on every request.

## Verification

```bash
node --test tests/gearProductionFoundation.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearPagesSellerDeletion.test.mjs tests/gearVerification.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --check lib/gear-moderation-actions.mjs
git diff --check
```

Tests use only temporary databases and fictitious identities. They cover schema
constraints/cascade, independent ledger survival, owner-restore denial, HTTP and
credential boundaries, ownership, immediate hiding, report/moderation separation,
exact recovery deadline, replay, seller verification, quota, live and stale
duplicates, elapsed and owner-moderated recovery, injected rollback, fresh and
populated migration upgrades, and the same delete/recover flow through D1/workerd.
