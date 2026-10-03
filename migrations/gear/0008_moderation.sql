-- Production moderation persistence. Report submission and moderation writes
-- are deliberately separate route increments; this migration defines their
-- constrained storage boundary without granting any HTTP write capability.
CREATE TABLE gear_reports (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES gear_listings(id),
  listing_title TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN (
    'Misleading listing',
    'Spam or suspicious activity',
    'Prohibited item',
    'Other concern'
  )),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  resolution TEXT NOT NULL DEFAULT 'open'
    CHECK(resolution IN ('open','dismissed','removed'))
);
CREATE INDEX gear_reports_queue
  ON gear_reports(resolution,created_at DESC,id);
CREATE INDEX gear_reports_listing
  ON gear_reports(listing_id);

CREATE TABLE gear_removals (
  listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id),
  previous_status TEXT NOT NULL CHECK(previous_status IN ('available','pending')),
  removed_at INTEGER NOT NULL CHECK(typeof(removed_at)='integer' AND removed_at>=0),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500)
);

-- History intentionally has no foreign keys. A bounded audit record can remain
-- during its retention window after its report or listing is permanently purged.
CREATE TABLE gear_moderation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  action TEXT NOT NULL CHECK(action IN ('dismiss','remove','restore','preserve-removal')),
  listing_id TEXT NOT NULL,
  report_id TEXT,
  report_reason TEXT CHECK(report_reason IS NULL OR report_reason IN (
    'Misleading listing',
    'Spam or suspicious activity',
    'Prohibited item',
    'Other concern'
  )),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  before_status TEXT NOT NULL
    CHECK(before_status IN ('unverified','available','pending','closed','expired','removed')),
  after_status TEXT NOT NULL
    CHECK(after_status IN ('unverified','available','pending','closed','expired','removed')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0)
);
CREATE INDEX gear_moderation_history_recent
  ON gear_moderation_history(created_at DESC,id DESC);
