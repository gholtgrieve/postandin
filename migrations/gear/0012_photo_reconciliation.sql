-- Provider reconciliation can discover an orphaned Gear image after its listing
-- context is gone. Preserve existing rows while allowing those cleanup records
-- to carry no misleading listing identifier.
CREATE TABLE gear_photo_deletions_next (
  provider_id TEXT PRIMARY KEY,
  listing_id TEXT,
  queued_at INTEGER NOT NULL
    CHECK(typeof(queued_at)='integer' AND queued_at>=0),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(attempts)='integer' AND attempts>=0),
  last_attempt_at INTEGER
    CHECK(last_attempt_at IS NULL OR (typeof(last_attempt_at)='integer' AND last_attempt_at>=queued_at))
);
INSERT INTO gear_photo_deletions_next(provider_id,listing_id,queued_at,attempts,last_attempt_at)
  SELECT provider_id,listing_id,queued_at,attempts,last_attempt_at FROM gear_photo_deletions;
DROP TABLE gear_photo_deletions;
ALTER TABLE gear_photo_deletions_next RENAME TO gear_photo_deletions;
CREATE INDEX gear_photo_deletions_queue
  ON gear_photo_deletions(attempts,queued_at,provider_id);
