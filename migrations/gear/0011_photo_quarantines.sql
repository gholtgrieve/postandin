-- Private Direct Creator Upload ownership and in-flight finalization state.
-- Deliberately no foreign keys: these provider IDs must survive listing/seller
-- deletion until remote Images cleanup or durable outbox staging succeeds.
CREATE TABLE gear_photo_quarantines (
  provider_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at),
  claim_hash TEXT UNIQUE,
  claimed_at INTEGER,
  sanitized_provider_id TEXT UNIQUE,
  sanitized_at INTEGER,
  attachment_id TEXT UNIQUE,
  CHECK((claim_hash IS NULL)=(claimed_at IS NULL)),
  CHECK(claim_hash IS NULL OR
    (length(claim_hash)=64 AND claim_hash=lower(claim_hash)
      AND claim_hash NOT GLOB '*[^0-9a-f]*'
      AND typeof(claimed_at)='integer' AND claimed_at>=created_at)),
  CHECK((sanitized_provider_id IS NULL AND sanitized_at IS NULL AND attachment_id IS NULL) OR
    (sanitized_provider_id IS NOT NULL AND claim_hash IS NOT NULL AND claimed_at IS NOT NULL
      AND attachment_id IS NOT NULL
      AND sanitized_provider_id<>provider_id
      AND typeof(sanitized_at)='integer' AND sanitized_at>=claimed_at))
);
CREATE INDEX gear_photo_quarantines_due
  ON gear_photo_quarantines(expires_at,claimed_at,provider_id);
CREATE INDEX gear_photo_quarantines_listing
  ON gear_photo_quarantines(listing_id,seller_id);
