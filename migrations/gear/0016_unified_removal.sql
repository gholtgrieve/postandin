-- The seller workflow now has one inactive state: removed. Convert legacy
-- indefinitely closed listings into the existing 30-day recovery lifecycle.
INSERT INTO gear_deletions(listing_id,previous_status,deleted_at,purge_at)
SELECT id,'closed',CAST(unixepoch('now') AS INTEGER)*1000,
  CAST(unixepoch('now') AS INTEGER)*1000+2592000000
FROM gear_listings
WHERE status='closed'
  AND NOT EXISTS(SELECT 1 FROM gear_deletions WHERE listing_id=gear_listings.id);

INSERT INTO gear_deletion_ledger(listing_id,deleted_at,purge_at,purged_at)
SELECT d.listing_id,d.deleted_at,d.purge_at,NULL
FROM gear_deletions d JOIN gear_listings l ON l.id=d.listing_id
WHERE l.status='closed'
ON CONFLICT(listing_id) DO NOTHING;

UPDATE gear_listings SET status='removed'
WHERE status='closed'
  AND EXISTS(SELECT 1 FROM gear_deletions WHERE listing_id=gear_listings.id);
