import { duplicateKey } from './gear-duplicates.mjs';
import { ADULT_ACKNOWLEDGEMENT_VERSION } from './gear-exchange.mjs';
import { validateDraft } from './gear-validation.mjs';

const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const revokedVerificationHash=()=>hex(crypto.getRandomValues(new Uint8Array(32)));

export async function createDraft(db, input, now = Date.now()) {
  const d=validateDraft(input), id=crypto.randomUUID(), sellerId=crypto.randomUUID();
  // Seller reuse is bookkeeping, never proof of ownership. Each listing needs
  // its own submission-bound verification token. Seller verification must never
  // publish other drafts; unverified drafts stay out of management and quotas.
  // D1 batch is transactional: seller, listing and club records succeed together.
  const key=duplicateKey(d);
  await db.batch([
    db.prepare('INSERT INTO gear_sellers(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(sellerId,d.email,now),
    db.prepare(`INSERT INTO gear_listings
      (id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,created_at,duplicate_key,adult_acknowledged_at,disclosure_version)
      VALUES(?,(SELECT id FROM gear_sellers WHERE email=?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,d.email,d.sellerName,d.title,d.description,d.category,d.size,d.fit,d.condition,d.city,d.type,d.priceCents,d.trade,d.otherClub,now,key,now,ADULT_ACKNOWLEDGEMENT_VERSION),
    ...d.clubs.map(club=>db.prepare('INSERT INTO gear_listing_clubs(listing_id,club) VALUES(?,?)').bind(id,club)),
  ]);
  return {id,status:'unverified'};
}
export async function updateDraft(db,id,input,now=Date.now()) {
  const d=validateDraft(input),sellerId=crypto.randomUUID(),key=duplicateKey(d),revokedHash=revokedVerificationHash();
  const results=await db.batch([
    db.prepare('INSERT INTO gear_sellers(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(sellerId,d.email,now),
    db.prepare(`UPDATE gear_listings SET seller_id=(SELECT id FROM gear_sellers WHERE email=?),seller_name=?,title=?,description=?,category=?,size=?,fit=?,condition=?,city=?,type=?,price_cents=?,trade=?,other_club=?,duplicate_key=?,management_clubs=?
      WHERE id=? AND status='unverified' AND verified_at IS NULL RETURNING id`)
      .bind(d.email,d.sellerName,d.title,d.description,d.category,d.size,d.fit,d.condition,d.city,d.type,d.priceCents,d.trade,d.otherClub,key,JSON.stringify(d.clubs),id),
    // Invalidate any emailed bearer token without erasing its durable cooldown
    // and issue count. Otherwise editing a draft could reset the five-email cap.
    db.prepare(`UPDATE gear_verification_tokens SET token_hash=?,email=?,expires_at=created_at+1,consumed_at=NULL WHERE listing_id=?
      AND EXISTS(SELECT 1 FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
        WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL AND s.email=?)`).bind(revokedHash,d.email,id,id,d.email),
  ]);
  return (results[1].meta?.changes??results[1].changes)>0;
}
// Trusted LOCAL tooling only. Do not expose this via Pages before ownership checks.
export async function readLocalDraft(db,id) {
  const row=await db.prepare(`SELECT l.*,s.email FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=? AND l.status='unverified'`).bind(id).first();
  if(!row) return null;
  const {results}=await db.prepare('SELECT club FROM gear_listing_clubs WHERE listing_id=? ORDER BY club').bind(id).all();
  return {...row,clubs:results.map(r=>r.club)};
}
async function publicListings(db,now,includePhotoRefs){
  const photoColumn=includePhotoRefs?`,(SELECT json_group_array(json_object('id',id,'providerId',provider_id))
    FROM (SELECT id,provider_id FROM gear_photos WHERE listing_id=l.id ORDER BY position,id)) AS photoRefs`:'';
  const {results}=await db.prepare(`SELECT l.id,l.title,l.description,l.category,l.size,l.fit,l.condition,l.city,
    l.type,l.price_cents AS priceCents,l.trade,l.other_club AS otherClub,l.seller_name AS sellerName,l.status,
    (SELECT json_group_array(club) FROM (SELECT club FROM gear_listing_clubs WHERE listing_id=l.id ORDER BY club)) AS clubs
    ${photoColumn}
    FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.status IN ('available','pending') AND l.verified_at IS NOT NULL
      AND s.verified_at IS NOT NULL AND l.expires_at>?
    ORDER BY l.created_at DESC,l.id LIMIT 100`).bind(now).all();
  return results.map(row=>({...row,clubs:JSON.parse(row.clubs),...(includePhotoRefs?{photoRefs:JSON.parse(row.photoRefs)}:{})}));
}
// Public read path deliberately selects only public fields, never seller email/ID.
export async function readPublicListings(db, now=Date.now()) {
  return publicListings(db,now,false);
}
// Trusted projection seam: callers must replace provider IDs with signed URLs.
export async function readPublicListingsWithPhotoRefs(db,now=Date.now()){
  return publicListings(db,now,true);
}
