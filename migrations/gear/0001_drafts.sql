-- All timestamps are Unix epoch milliseconds (Date.now()), not seconds.
-- Additive foundation. No tokens, publication or ownership grants in this migration.
CREATE TABLE gear_sellers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK(email=lower(email)),
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE gear_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES gear_sellers(id),
  seller_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  size TEXT NOT NULL,
  fit TEXT NOT NULL,
  condition TEXT NOT NULL,
  city TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('sale','trade','free')),
  price_cents INTEGER,
  trade TEXT NOT NULL DEFAULT '',
  other_club TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(status IN ('unverified','available','pending','closed','expired','removed')),
  verified_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK((type='sale' AND price_cents IS NOT NULL AND typeof(price_cents)='integer' AND price_cents BETWEEN 100 AND 500000)
    OR (type='free' AND price_cents IS NOT NULL AND price_cents=0) OR (type='trade' AND price_cents IS NULL)),
  CHECK((type='trade' AND length(trade)>0) OR (type!='trade' AND trade='')),
  CHECK(status NOT IN ('available','pending') OR (verified_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE TABLE gear_listing_clubs (
  listing_id TEXT NOT NULL REFERENCES gear_listings(id) ON DELETE CASCADE,
  club TEXT NOT NULL,
  PRIMARY KEY(listing_id,club)
);
CREATE INDEX gear_visibility ON gear_listings(status,expires_at,created_at);
CREATE INDEX gear_seller_listings ON gear_listings(seller_id,status);
