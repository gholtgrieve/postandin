import {requireGearImageProviderId} from './gear-image-provider-id.mjs';
import {photoManagedListingSQL,photoManagementCredentials} from './gear-photo-quarantine.mjs';

export const GEAR_SELLER_PHOTO_UPLOADS_PER_DAY=60;
export const GEAR_PHOTO_UPLOAD_WINDOW_MS=86400000;
export const GEAR_PHOTO_UPLOAD_LIMIT_RETENTION_MS=GEAR_PHOTO_UPLOAD_WINDOW_MS;

function clock(now){
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+GEAR_PHOTO_UPLOAD_LIMIT_RETENTION_MS))throw new TypeError('Invalid photo upload limit timestamp.');
}

export async function consumeSellerPhotoUpload(db,session,csrf,listingId,now=Date.now()){
  clock(now);requireGearImageProviderId(listingId,'Listing ID');
  const c=await photoManagementCredentials(session,csrf);if(!c)return {allowed:false,reason:'unavailable'};
  const windowStart=Math.floor(now/GEAR_PHOTO_UPLOAD_WINDOW_MS)*GEAR_PHOTO_UPLOAD_WINDOW_MS;
  const row=await db.prepare(`INSERT INTO gear_photo_upload_limits(seller_id,window_start,attempts,expires_at)
    SELECT l.seller_id,?,1,? FROM gear_listings l WHERE l.id=? AND ${photoManagedListingSQL}
    ON CONFLICT(seller_id,window_start) DO UPDATE SET attempts=attempts+1
      WHERE attempts<?
    RETURNING attempts`)
    .bind(windowStart,windowStart+GEAR_PHOTO_UPLOAD_LIMIT_RETENTION_MS,listingId,c.session,c.csrf,now,now,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY).first();
  if(row)return {allowed:true,remaining:GEAR_SELLER_PHOTO_UPLOADS_PER_DAY-row.attempts,resetAt:windowStart+GEAR_PHOTO_UPLOAD_WINDOW_MS};
  const limited=await db.prepare(`SELECT r.attempts FROM gear_photo_upload_limits r
    JOIN gear_listings l ON l.seller_id=r.seller_id
    WHERE l.id=? AND r.window_start=? AND ${photoManagedListingSQL} AND r.attempts>=?`)
    .bind(listingId,windowStart,c.session,c.csrf,now,now,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY).first();
  return limited
    ?{allowed:false,reason:'limited',retryAfterSeconds:Math.max(1,Math.ceil((windowStart+GEAR_PHOTO_UPLOAD_WINDOW_MS-now)/1000))}
    :{allowed:false,reason:'unavailable'};
}
