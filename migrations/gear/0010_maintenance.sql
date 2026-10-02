-- Durable handoff between D1 record purge and Cloudflare Images deletion.
-- Provider IDs survive the listing/photo cascade until the scheduled Worker
-- confirms the hosted object is gone. Deleting a missing hosted object is
-- treated as success, so retries remain idempotent.
CREATE TABLE gear_photo_deletions (
  provider_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  queued_at INTEGER NOT NULL
    CHECK(typeof(queued_at)='integer' AND queued_at>=0),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(attempts)='integer' AND attempts>=0),
  last_attempt_at INTEGER
    CHECK(last_attempt_at IS NULL OR (typeof(last_attempt_at)='integer' AND last_attempt_at>=queued_at))
);
CREATE INDEX gear_photo_deletions_queue
  ON gear_photo_deletions(attempts,queued_at,provider_id);
