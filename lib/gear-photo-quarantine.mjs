import {requireGearImageProviderId} from './gear-image-provider-id.mjs';

const SECRET=/^[0-9a-f]{64}$/;
export const GEAR_QUARANTINE_TTL_MS=10*60*1000;
export const GEAR_QUARANTINE_CLAIM_MS=5*60*1000;

const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const changes=result=>result?.meta?.changes??result?.changes??0;

function clock(now){
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+GEAR_QUARANTINE_TTL_MS))throw new TypeError('Invalid quarantine timestamp.');
}
function id(value,label){return requireGearImageProviderId(value,label);}
async function credentials(session,csrf){
  if(typeof session!=='string'||typeof csrf!=='string'||!SECRET.test(session)||!SECRET.test(csrf))return null;
  return {session:await hash(session),csrf:await hash(csrf)};
}
const ownerSQL=`SELECT seller_id FROM gear_management_sessions
  WHERE session_hash=? AND csrf_hash=? AND revoked_at IS NULL AND created_at<=? AND expires_at>?`;
const managedListing=`l.seller_id=(${ownerSQL}) AND l.verified_at IS NOT NULL
  AND l.status IN ('available','pending','closed','expired')`;

export async function recordPhotoQuarantine(db,session,csrf,listingId,providerId,now=Date.now()){
  clock(now);id(listingId,'Listing ID');id(providerId,'Provider ID');
  const c=await credentials(session,csrf);if(!c)return null;
  return db.prepare(`INSERT INTO gear_photo_quarantines
    (provider_id,listing_id,seller_id,created_at,expires_at,claim_hash,claimed_at,sanitized_provider_id,sanitized_at,attachment_id)
    SELECT ?,l.id,l.seller_id,?,?,NULL,NULL,NULL,NULL,NULL FROM gear_listings l
    WHERE l.id=? AND ${managedListing}
      AND (SELECT count(*) FROM gear_photos p WHERE p.listing_id=l.id)
        +(SELECT count(*) FROM gear_photo_quarantines q
          WHERE q.listing_id=l.id AND q.expires_at>? AND q.sanitized_provider_id IS NULL)<6
    RETURNING provider_id AS providerId,listing_id AS listingId,created_at AS createdAt,expires_at AS expiresAt`)
    .bind(providerId,now,now+GEAR_QUARANTINE_TTL_MS,listingId,c.session,c.csrf,now,now,now).first();
}

export async function claimPhotoQuarantine(db,session,csrf,providerId,now=Date.now()){
  clock(now);id(providerId,'Provider ID');const c=await credentials(session,csrf);if(!c)return null;
  const claim=random(),claimHash=await hash(claim);
  const row=await db.prepare(`UPDATE gear_photo_quarantines AS q SET claim_hash=?,claimed_at=?
    WHERE q.provider_id=? AND q.expires_at>? AND q.sanitized_provider_id IS NULL
      AND (q.claim_hash IS NULL OR q.claimed_at<=?)
      AND q.seller_id=(${ownerSQL})
      AND EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=q.listing_id AND l.seller_id=q.seller_id
        AND ${managedListing})
    RETURNING listing_id AS listingId,expires_at AS expiresAt`)
    .bind(claimHash,now,providerId,now,now-GEAR_QUARANTINE_CLAIM_MS,c.session,c.csrf,now,now,c.session,c.csrf,now,now).first();
  return row?{...row,claim}:null;
}

export async function releasePhotoQuarantine(db,providerId,claim,now=Date.now()){
  clock(now);id(providerId,'Provider ID');if(typeof claim!=='string'||!SECRET.test(claim))return false;
  const row=await db.prepare(`UPDATE gear_photo_quarantines SET claim_hash=NULL,claimed_at=NULL
    WHERE provider_id=? AND claim_hash=? AND sanitized_provider_id IS NULL AND claimed_at<=?
    RETURNING provider_id`).bind(providerId,await hash(claim),now).first();
  return Boolean(row);
}

export async function attachClaimedPhoto(db,session,csrf,providerId,claim,sanitizedProviderId,now=Date.now()){
  clock(now);id(providerId,'Provider ID');id(sanitizedProviderId,'Sanitized provider ID');
  if(sanitizedProviderId===providerId)throw new TypeError('Sanitized provider ID must differ from the quarantine ID.');
  if(typeof claim!=='string'||!SECRET.test(claim))return null;
  const c=await credentials(session,csrf);if(!c)return null;
  const claimHash=await hash(claim),photoId=crypto.randomUUID(),attachmentId=crypto.randomUUID();
  const authorized=`q.provider_id=? AND q.claim_hash=? AND q.claimed_at>? AND q.claimed_at<=q.expires_at
    AND q.seller_id=(${ownerSQL}) AND EXISTS(SELECT 1 FROM gear_listings l
      WHERE l.id=q.listing_id AND l.seller_id=q.seller_id AND ${managedListing})`;
  const args=()=>[providerId,claimHash,now-GEAR_QUARANTINE_CLAIM_MS,c.session,c.csrf,now,now,c.session,c.csrf,now,now];
  const results=await db.batch([
    db.prepare(`UPDATE gear_photo_quarantines AS q SET sanitized_provider_id=?,sanitized_at=?,attachment_id=?
      WHERE ${authorized} AND q.sanitized_provider_id IS NULL`).bind(sanitizedProviderId,now,attachmentId,...args()),
    db.prepare(`INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at)
      SELECT ?,q.listing_id,q.sanitized_provider_id,candidate.value,? FROM gear_photo_quarantines q,json_each('[0,1,2,3,4,5]') candidate
      WHERE ${authorized} AND q.sanitized_provider_id=? AND q.attachment_id=?
        AND NOT EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.position=candidate.value)
      ORDER BY candidate.value LIMIT 1`).bind(photoId,now,...args(),sanitizedProviderId,attachmentId),
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT q.provider_id,q.listing_id,? FROM gear_photo_quarantines q
      WHERE ${authorized} AND q.sanitized_provider_id=? AND q.attachment_id=?
        AND EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.provider_id=q.sanitized_provider_id)
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,...args(),sanitizedProviderId,attachmentId),
    db.prepare(`DELETE FROM gear_photo_quarantines AS q WHERE ${authorized} AND q.sanitized_provider_id=?
      AND q.attachment_id=?
      AND EXISTS(SELECT 1 FROM gear_photo_deletions d WHERE d.provider_id=q.provider_id)
      AND EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.provider_id=q.sanitized_provider_id)`)
      .bind(...args(),sanitizedProviderId,attachmentId),
  ]);
  if(changes(results[1])===1&&changes(results[3])===1){
    const row=await db.prepare(`SELECT id,listing_id AS listingId,provider_id AS providerId,position,created_at AS createdAt
      FROM gear_photos WHERE id=?`).bind(photoId).first();
    return {ok:true,photo:row};
  }
  if(changes(results[1])!==0||changes(results[3])!==0)throw new Error('Photo quarantine attachment invariant failed.');
  const attached=await db.prepare('SELECT 1 AS present FROM gear_photos WHERE provider_id=?').bind(sanitizedProviderId).first();
  if(attached)return {ok:false,reason:'attached'};
  const retained=await db.prepare(`SELECT provider_id FROM gear_photo_quarantines
    WHERE provider_id=? AND claim_hash=? AND sanitized_provider_id=?`).bind(providerId,claimHash,sanitizedProviderId).first();
  return retained?{ok:false,reason:'conflict',cleanupProviderIds:[sanitizedProviderId]}:null;
}
