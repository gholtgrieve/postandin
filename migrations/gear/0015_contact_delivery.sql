-- Durable public-contact idempotency, abuse accounting and short-lived delivery
-- copies. All timestamps are epoch milliseconds. No mail is sent by this schema.
CREATE TABLE gear_contact_attempts (
  id TEXT PRIMARY KEY CHECK(length(id)=36 AND id=lower(id)),
  listing_id TEXT NOT NULL CHECK(length(listing_id)=36 AND listing_id=lower(listing_id)),
  buyer_hash TEXT NOT NULL CHECK(length(buyer_hash)=64 AND buyer_hash=lower(buyer_hash) AND buyer_hash NOT GLOB '*[^0-9a-f]*'),
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash=lower(input_hash) AND input_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0)
);
CREATE INDEX gear_contact_attempts_limits
  ON gear_contact_attempts(created_at,buyer_hash,listing_id);

CREATE TABLE gear_contact_messages (
  id TEXT PRIMARY KEY CHECK(length(id)=36 AND id=lower(id)),
  input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash=lower(input_hash) AND input_hash NOT GLOB '*[^0-9a-f]*'),
  listing_id TEXT NOT NULL REFERENCES gear_listings(id) ON DELETE CASCADE,
  listing_title TEXT NOT NULL CHECK(length(listing_title) BETWEEN 1 AND 100),
  recipient TEXT NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254 AND recipient=lower(recipient)),
  buyer_name TEXT NOT NULL CHECK(length(buyer_name) BETWEEN 1 AND 60),
  buyer_email TEXT NOT NULL CHECK(length(buyer_email) BETWEEN 3 AND 254 AND buyer_email=lower(buyer_email)),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent')),
  claim_hash TEXT,
  claimed_at INTEGER,
  provider_id TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=created_at+86400000),
  CHECK((status='pending' AND claim_hash IS NULL AND claimed_at IS NULL AND provider_id IS NULL AND sent_at IS NULL) OR
    (status='sending' AND length(claim_hash)=64 AND claim_hash=lower(claim_hash) AND claim_hash NOT GLOB '*[^0-9a-f]*'
      AND typeof(claimed_at)='integer' AND claimed_at>=created_at AND provider_id IS NULL AND sent_at IS NULL) OR
    (status='sent' AND claim_hash IS NULL AND claimed_at IS NULL AND length(provider_id)=36 AND provider_id=lower(provider_id)
      AND typeof(sent_at)='integer' AND sent_at>=created_at))
);
CREATE INDEX gear_contact_messages_expiry
  ON gear_contact_messages(expires_at,id);
