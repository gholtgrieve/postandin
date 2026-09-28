const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validId(value,label) {
  if(typeof value!=='string'||!UUID.test(value))throw new TypeError(`${label} must be a lowercase UUID.`);
  return value;
}

// Low-level D1 metadata adapter only. A future authenticated route must verify
// listing ownership and confirm a successful Cloudflare Images upload first.
export async function recordHostedPhoto(db,listingId,providerId,now=Date.now()) {
  validId(listingId,'Listing ID');validId(providerId,'Provider ID');
  if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Timestamp must be a non-negative safe integer.');
  return db.prepare(`INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at)
    SELECT ?,?,?,candidate.value,? FROM json_each('[0,1,2,3,4,5]') AS candidate
    WHERE EXISTS(SELECT 1 FROM gear_listings WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM gear_photos WHERE listing_id=? AND position=candidate.value)
    ORDER BY candidate.value LIMIT 1
    RETURNING id,listing_id AS listingId,provider_id AS providerId,position,created_at AS createdAt`)
    .bind(crypto.randomUUID(),listingId,providerId,now,listingId,listingId).first();
}

export async function readHostedPhotos(db,listingId) {
  validId(listingId,'Listing ID');
  const {results}=await db.prepare(`SELECT id,listing_id AS listingId,provider_id AS providerId,
    position,created_at AS createdAt FROM gear_photos WHERE listing_id=? ORDER BY position,id`).bind(listingId).all();
  return results;
}
