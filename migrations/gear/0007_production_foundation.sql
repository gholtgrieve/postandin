-- Preserve legacy rows while requiring an auditable acknowledgement on every
-- new listing. Existing rows intentionally remain NULL rather than fabricating
-- consent that was not recorded at creation time.
ALTER TABLE gear_listings ADD COLUMN adult_acknowledged_at INTEGER;
ALTER TABLE gear_listings ADD COLUMN disclosure_version TEXT;

CREATE TRIGGER gear_listing_adult_insert BEFORE INSERT ON gear_listings
WHEN NEW.adult_acknowledged_at IS NULL
  OR typeof(NEW.adult_acknowledged_at)!='integer'
  OR NEW.adult_acknowledged_at<0
  OR NEW.adult_acknowledged_at!=NEW.created_at
  OR NEW.disclosure_version!='gear-adult-v1'
BEGIN
  SELECT RAISE(ABORT,'Adult acknowledgement required');
END;

CREATE TRIGGER gear_listing_adult_immutable
BEFORE UPDATE OF adult_acknowledged_at,disclosure_version ON gear_listings
WHEN NEW.adult_acknowledged_at IS NOT OLD.adult_acknowledged_at
  OR NEW.disclosure_version IS NOT OLD.disclosure_version
BEGIN
  SELECT RAISE(ABORT,'Adult acknowledgement is immutable');
END;

-- Cloudflare Images stores the bytes. D1 stores only the provider identifier
-- and deterministic display order; signed delivery URLs and upload credentials
-- must never be persisted here.
-- Never use INSERT OR REPLACE for listings: replacement is delete-plus-insert
-- and would also cascade-delete club and photo metadata.
CREATE TABLE gear_photos (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES gear_listings(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL,
  UNIQUE(listing_id,position)
);
CREATE INDEX gear_photos_listing ON gear_photos(listing_id,position);
