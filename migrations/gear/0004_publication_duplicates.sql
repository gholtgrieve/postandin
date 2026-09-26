-- Upgrade earlier local previews too: abandoned drafts never reserve an item.
DROP INDEX gear_no_duplicates;
CREATE UNIQUE INDEX gear_no_duplicates ON gear_listings(seller_id,duplicate_key)
  WHERE status IN ('available','pending');
DROP TRIGGER gear_verify_publish;
CREATE TRIGGER gear_verify_publish AFTER UPDATE OF consumed_at ON gear_verification_tokens
WHEN NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL
BEGIN
  UPDATE gear_listings SET status='expired'
    WHERE seller_id=(SELECT seller_id FROM gear_listings WHERE id=NEW.listing_id)
      AND duplicate_key=(SELECT duplicate_key FROM gear_listings WHERE id=NEW.listing_id)
      AND status IN ('available','pending') AND expires_at<=NEW.consumed_at;
  UPDATE gear_sellers SET verified_at=coalesce(verified_at,NEW.consumed_at)
    WHERE id=(SELECT seller_id FROM gear_listings WHERE id=NEW.listing_id);
  -- A unique violation rolls back token consumption and all these writes.
  UPDATE gear_listings SET status='available',verified_at=NEW.consumed_at,
    expires_at=NEW.consumed_at+2592000000 WHERE id=NEW.listing_id;
END;
