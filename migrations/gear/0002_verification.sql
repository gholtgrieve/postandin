-- Times are Unix epoch milliseconds. One current token per submission.
CREATE TABLE gear_verification_tokens (
  listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  consumed_at INTEGER
);
-- These triggers make consumption, quota checking and publication one atomic
-- statement. Any failed publication rolls the token consumption back too.
CREATE TRIGGER gear_verify_guard BEFORE UPDATE OF consumed_at ON gear_verification_tokens
WHEN NEW.consumed_at IS NOT NULL
BEGIN
  SELECT CASE WHEN OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at < OLD.created_at OR NEW.consumed_at >= OLD.expires_at
    OR NOT EXISTS(SELECT 1 FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
      WHERE l.id=OLD.listing_id AND l.status='unverified' AND l.verified_at IS NULL
      AND s.email=OLD.email)
    THEN RAISE(ABORT,'Invalid verification transition') END;
  SELECT CASE WHEN (SELECT count(*) FROM gear_listings a
    WHERE a.seller_id=(SELECT seller_id FROM gear_listings WHERE id=OLD.listing_id)
      AND a.status IN ('available','pending') AND a.expires_at>NEW.consumed_at)>=10
    THEN RAISE(ABORT,'Active listing limit') END;
END;
CREATE TRIGGER gear_verify_publish AFTER UPDATE OF consumed_at ON gear_verification_tokens
WHEN NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL
BEGIN
  UPDATE gear_sellers SET verified_at=coalesce(verified_at,NEW.consumed_at)
    WHERE id=(SELECT seller_id FROM gear_listings WHERE id=NEW.listing_id);
  UPDATE gear_listings SET status='available',verified_at=NEW.consumed_at,
    expires_at=NEW.consumed_at+2592000000 WHERE id=NEW.listing_id;
END;
