import {GEAR_DRAFT_RETENTION_MS} from './gear-exchange.mjs';
import {requireGearImageProviderId} from './gear-image-provider-id.mjs';
import {GEAR_PHOTO_UPLOAD_LIMIT_RETENTION_MS,GEAR_PHOTO_UPLOAD_WINDOW_MS,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY} from './gear-photo-rate-limit.mjs';
import {GEAR_QUARANTINE_CLAIM_MS,GEAR_QUARANTINE_TTL_MS} from './gear-photo-quarantine.mjs';

const SECRET=/^[0-9a-f]{64}$/;
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const changes=result=>result?.meta?.changes??result?.changes??0;
const clock=now=>{if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid draft photo timestamp.');};
const id=(value,label)=>requireGearImageProviderId(value,label);

export async function issueDraftPhotoAccess(db,listingId,now=Date.now()){
  clock(now);id(listingId,'Listing ID');const token=random();
  const row=await db.prepare(`INSERT INTO gear_draft_photo_access(listing_id,token_hash,created_at,expires_at)
    SELECT id,?,?,? FROM gear_listings WHERE id=? AND status='unverified' AND verified_at IS NULL AND created_at>?
    RETURNING expires_at AS expiresAt`).bind(await hash(token),now,now+GEAR_DRAFT_RETENTION_MS,listingId,now-GEAR_DRAFT_RETENTION_MS).first();
  return row?{token,expiresAt:row.expiresAt}:null;
}

async function credential(token){return typeof token==='string'&&SECRET.test(token)?hash(token):null;}
const accessSQL=`EXISTS(SELECT 1 FROM gear_draft_photo_access a
  WHERE a.listing_id=l.id AND a.token_hash=? AND a.created_at<=? AND a.expires_at>?)
  AND l.status='unverified' AND l.verified_at IS NULL AND l.created_at>?`;

export async function hasDraftPhotoAccess(db,token,now=Date.now()){
  clock(now);const tokenHash=await credential(token);if(!tokenHash)return false;
  return Boolean(await db.prepare(`SELECT 1 AS allowed FROM gear_listings l WHERE ${accessSQL} LIMIT 1`)
    .bind(tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS).first());
}

export async function canRecordDraftPhoto(db,token,listingId,now=Date.now()){
  clock(now);id(listingId,'Listing ID');const tokenHash=await credential(token);if(!tokenHash)return false;
  return Boolean(await db.prepare(`SELECT 1 AS allowed FROM gear_listings l WHERE l.id=? AND ${accessSQL}
    AND (SELECT count(*) FROM gear_photos p WHERE p.listing_id=l.id)
      +(SELECT count(*) FROM gear_photo_quarantines q WHERE q.listing_id=l.id AND q.expires_at>? AND q.sanitized_provider_id IS NULL)<6`)
    .bind(listingId,tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS,now).first());
}

export async function consumeDraftPhotoUpload(db,token,listingId,now=Date.now()){
  clock(now);id(listingId,'Listing ID');const tokenHash=await credential(token);if(!tokenHash)return {allowed:false,reason:'unavailable'};
  const windowStart=Math.floor(now/GEAR_PHOTO_UPLOAD_WINDOW_MS)*GEAR_PHOTO_UPLOAD_WINDOW_MS;
  const row=await db.prepare(`INSERT INTO gear_photo_upload_limits(seller_id,window_start,attempts,expires_at)
    SELECT l.seller_id,?,1,? FROM gear_listings l WHERE l.id=? AND ${accessSQL}
    ON CONFLICT(seller_id,window_start) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts`)
    .bind(windowStart,windowStart+GEAR_PHOTO_UPLOAD_LIMIT_RETENTION_MS,listingId,tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY).first();
  if(row)return {allowed:true,remaining:GEAR_SELLER_PHOTO_UPLOADS_PER_DAY-row.attempts,resetAt:windowStart+GEAR_PHOTO_UPLOAD_WINDOW_MS};
  return {allowed:false,reason:'limited',retryAfterSeconds:Math.max(1,Math.ceil((windowStart+GEAR_PHOTO_UPLOAD_WINDOW_MS-now)/1000))};
}

export async function recordDraftPhotoQuarantine(db,token,listingId,providerId,now=Date.now()){
  clock(now);id(listingId,'Listing ID');id(providerId,'Provider ID');const tokenHash=await credential(token);if(!tokenHash)return null;
  return db.prepare(`INSERT INTO gear_photo_quarantines
    (provider_id,listing_id,seller_id,created_at,expires_at,claim_hash,claimed_at,sanitized_provider_id,sanitized_at,attachment_id)
    SELECT ?,l.id,l.seller_id,?,?,NULL,NULL,NULL,NULL,NULL FROM gear_listings l WHERE l.id=? AND ${accessSQL}
      AND (SELECT count(*) FROM gear_photos p WHERE p.listing_id=l.id)
        +(SELECT count(*) FROM gear_photo_quarantines q WHERE q.listing_id=l.id AND q.expires_at>? AND q.sanitized_provider_id IS NULL)<6
    RETURNING provider_id AS providerId,listing_id AS listingId,created_at AS createdAt,expires_at AS expiresAt`)
    .bind(providerId,now,now+GEAR_QUARANTINE_TTL_MS,listingId,tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS,now).first();
}

export async function claimDraftPhotoQuarantine(db,token,providerId,now=Date.now()){
  clock(now);id(providerId,'Provider ID');const tokenHash=await credential(token);if(!tokenHash)return null;
  const claim=random(),claimHash=await hash(claim);
  const row=await db.prepare(`UPDATE gear_photo_quarantines AS q SET claim_hash=?,claimed_at=?
    WHERE q.provider_id=? AND q.expires_at>? AND q.sanitized_provider_id IS NULL
      AND (q.claim_hash IS NULL OR q.claimed_at<=?)
      AND EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=q.listing_id AND l.seller_id=q.seller_id AND ${accessSQL})
    RETURNING listing_id AS listingId,expires_at AS expiresAt`)
    .bind(claimHash,now,providerId,now,now-GEAR_QUARANTINE_CLAIM_MS,tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS).first();
  return row?{...row,claim}:null;
}

export async function attachClaimedDraftPhoto(db,token,providerId,claim,sanitizedProviderId,now=Date.now()){
  clock(now);id(providerId,'Provider ID');id(sanitizedProviderId,'Sanitized provider ID');
  if(sanitizedProviderId===providerId)throw new TypeError('Sanitized provider ID must differ from the quarantine ID.');
  if(typeof claim!=='string'||!SECRET.test(claim))return null;const tokenHash=await credential(token);if(!tokenHash)return null;
  const claimHash=await hash(claim),photoId=crypto.randomUUID(),attachmentId=crypto.randomUUID();
  const authorized=`q.provider_id=? AND q.claim_hash=? AND q.claimed_at>? AND q.claimed_at<=q.expires_at
    AND EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=q.listing_id AND l.seller_id=q.seller_id AND ${accessSQL})`;
  const args=()=>[providerId,claimHash,now-GEAR_QUARANTINE_CLAIM_MS,tokenHash,now,now,now-GEAR_DRAFT_RETENTION_MS];
  const results=await db.batch([
    db.prepare(`UPDATE gear_photo_quarantines AS q SET sanitized_provider_id=?,sanitized_at=?,attachment_id=?
      WHERE ${authorized} AND q.sanitized_provider_id IS NULL`).bind(sanitizedProviderId,now,attachmentId,...args()),
    db.prepare(`INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at)
      SELECT ?,q.listing_id,q.sanitized_provider_id,candidate.value,? FROM gear_photo_quarantines q,json_each('[0,1,2,3,4,5]') candidate
      WHERE ${authorized} AND q.sanitized_provider_id=? AND q.attachment_id=?
        AND NOT EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.position=candidate.value)
      ORDER BY candidate.value LIMIT 1`).bind(photoId,now,...args(),sanitizedProviderId,attachmentId),
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT q.provider_id,q.listing_id,? FROM gear_photo_quarantines q WHERE ${authorized}
        AND q.sanitized_provider_id=? AND q.attachment_id=?
        AND EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.provider_id=q.sanitized_provider_id)
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,...args(),sanitizedProviderId,attachmentId),
    db.prepare(`DELETE FROM gear_photo_quarantines AS q WHERE ${authorized} AND q.sanitized_provider_id=? AND q.attachment_id=?
      AND EXISTS(SELECT 1 FROM gear_photo_deletions d WHERE d.provider_id=q.provider_id)
      AND EXISTS(SELECT 1 FROM gear_photos p WHERE p.listing_id=q.listing_id AND p.provider_id=q.sanitized_provider_id)`)
      .bind(...args(),sanitizedProviderId,attachmentId),
  ]);
  if(changes(results[1])===1&&changes(results[3])===1)return {ok:true};
  if(changes(results[1])!==0||changes(results[3])!==0)throw new Error('Draft photo attachment invariant failed.');
  const attached=await db.prepare('SELECT 1 AS present FROM gear_photos WHERE provider_id=?').bind(sanitizedProviderId).first();
  if(attached)return {ok:false,reason:'attached'};
  const retained=await db.prepare(`SELECT provider_id FROM gear_photo_quarantines WHERE provider_id=? AND claim_hash=? AND sanitized_provider_id=?`)
    .bind(providerId,claimHash,sanitizedProviderId).first();
  return retained?{ok:false,reason:'conflict',cleanupProviderIds:[sanitizedProviderId]}:null;
}
