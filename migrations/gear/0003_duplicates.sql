-- App/local migration runner backfills legacy keys before this feature is used.
-- NULL is retained only for older rows until that backfill completes.
ALTER TABLE gear_listings ADD COLUMN duplicate_key TEXT;
CREATE UNIQUE INDEX gear_no_duplicates ON gear_listings(seller_id,duplicate_key)
  WHERE status IN ('available','pending');
