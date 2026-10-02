-- Production seller-deletion state. Seller routes and permanent cleanup are
-- separate increments; this durable marker already blocks owner restoration.
CREATE TABLE gear_deletions (
  listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL
    CHECK(previous_status IN ('available','pending','closed','expired','removed')),
  deleted_at INTEGER NOT NULL
    CHECK(typeof(deleted_at)='integer' AND deleted_at>=0),
  purge_at INTEGER NOT NULL
    CHECK(typeof(purge_at)='integer' AND purge_at>deleted_at)
);
CREATE INDEX gear_deletions_due ON gear_deletions(purge_at,listing_id);

-- This minimal ledger intentionally has no listing foreign key so a later
-- cleanup can retain the restriction after the listing itself is purged.
CREATE TABLE gear_deletion_ledger (
  listing_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
    CHECK(typeof(deleted_at)='integer' AND deleted_at>=0),
  purge_at INTEGER NOT NULL
    CHECK(typeof(purge_at)='integer' AND purge_at>deleted_at),
  purged_at INTEGER
    CHECK(purged_at IS NULL OR (typeof(purged_at)='integer' AND purged_at>=purge_at))
);
CREATE INDEX gear_deletion_ledger_retention
  ON gear_deletion_ledger(purged_at,listing_id);
