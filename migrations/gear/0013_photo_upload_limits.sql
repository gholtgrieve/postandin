-- Short-lived seller upload budgets. IP bursts are handled by the required
-- Cloudflare edge rule, so D1 stores no network address or derived identifier.
CREATE TABLE gear_photo_upload_limits (
  seller_id TEXT NOT NULL REFERENCES gear_sellers(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL
    CHECK(typeof(window_start)='integer' AND window_start>=0 AND window_start%86400000=0),
  attempts INTEGER NOT NULL
    CHECK(typeof(attempts)='integer' AND attempts>=1),
  expires_at INTEGER NOT NULL
    CHECK(typeof(expires_at)='integer' AND expires_at=window_start+86400000),
  PRIMARY KEY(seller_id,window_start)
);
CREATE INDEX gear_photo_upload_limits_expiry
  ON gear_photo_upload_limits(expires_at,seller_id);
