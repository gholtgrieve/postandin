-- Milliseconds. Recovery links and sessions are separate credential scopes.
CREATE TABLE gear_management_links (
  seller_id TEXT PRIMARY KEY REFERENCES gear_sellers(id),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  session_hash TEXT,
  csrf_hash TEXT
);
CREATE TABLE gear_management_sessions (
  session_hash TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES gear_sellers(id),
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX gear_sessions_seller ON gear_management_sessions(seller_id);
CREATE TRIGGER gear_management_redeem AFTER UPDATE OF consumed_at ON gear_management_links
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
  UPDATE gear_management_sessions SET revoked_at=NEW.consumed_at
    WHERE seller_id=NEW.seller_id AND revoked_at IS NULL;
  INSERT INTO gear_management_sessions(session_hash,seller_id,csrf_hash,created_at,expires_at)
    VALUES(NEW.session_hash,NEW.seller_id,NEW.csrf_hash,NEW.consumed_at,NEW.consumed_at+86400000);
END;
-- Club changes and content changes use a single guarded UPDATE; its trigger
-- replaces club rows atomically. This column is an internal write payload.
ALTER TABLE gear_listings ADD COLUMN management_clubs TEXT;
CREATE TRIGGER gear_management_clubs AFTER UPDATE OF management_clubs ON gear_listings
WHEN NEW.management_clubs IS NOT NULL
BEGIN
  DELETE FROM gear_listing_clubs WHERE listing_id=NEW.id;
  INSERT INTO gear_listing_clubs(listing_id,club)
    SELECT NEW.id,value FROM json_each(NEW.management_clubs);
END;
