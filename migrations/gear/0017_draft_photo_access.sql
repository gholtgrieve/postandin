-- A draft-scoped bearer credential lets the browser attach private photos
-- before email verification. It grants no seller-management access and is
-- destroyed as soon as the listing is verified or the draft is deleted.
CREATE TABLE gear_draft_photo_access (
  listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK(length(token_hash)=64 AND token_hash=lower(token_hash)
      AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL
    CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER NOT NULL
    CHECK(typeof(expires_at)='integer' AND expires_at>created_at)
);
CREATE INDEX gear_draft_photo_access_expiry
  ON gear_draft_photo_access(expires_at,listing_id);

CREATE TRIGGER gear_draft_photo_access_verified
AFTER UPDATE OF verified_at ON gear_listings
WHEN OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL
BEGIN
  DELETE FROM gear_draft_photo_access WHERE listing_id=NEW.id;
END;
