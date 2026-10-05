-- Durable, listing-scoped credentials for the saved post-verification email.
-- Recovery links remain short-lived, one-use, and seller-wide.
CREATE TABLE gear_listing_management_links (
  listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE gear_management_sessions ADD COLUMN listing_id TEXT
  REFERENCES gear_listings(id) ON DELETE CASCADE;

CREATE INDEX gear_sessions_listing ON gear_management_sessions(listing_id);

-- A verified email transfer invalidates every durable credential belonging to
-- either side of the transfer, regardless of trigger execution order.
CREATE TRIGGER gear_email_change_revoke_listing_links AFTER UPDATE OF consumed_at ON gear_email_changes
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
  DELETE FROM gear_listing_management_links
    WHERE listing_id IN (
      SELECT id FROM gear_listings
      WHERE seller_id IN (NEW.seller_id,(SELECT id FROM gear_sellers WHERE email=NEW.target_email))
    );
END;
