import { LIMITS } from './gear-exchange.mjs';
export const TOKEN_TTL_MS=30*60*1000;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hashToken(token){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));}
function validTime(now){if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid clock');}

// Trusted local mail-sink boundary, NOT a public token-issuance endpoint.
// A real delivery adapter must send the receipt only to its recorded recipient.
export async function issueLocalVerification(db,listingId,now=Date.now()){
  validTime(now);
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await hashToken(token);
  const row=await db.prepare(`INSERT INTO gear_verification_tokens
    (listing_id,token_hash,email,created_at,expires_at,consumed_at)
    SELECT l.id,?,s.email,?,?,NULL FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL
    ON CONFLICT(listing_id) DO UPDATE SET token_hash=excluded.token_hash,
      email=excluded.email,created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=NULL
    RETURNING email,expires_at`).bind(hash,now,now+TOKEN_TTL_MS,listingId).first();
  return row?{recipient:row.email,token,expiresAt:row.expires_at,delivery:'local-simulation'}:null;
}

// Only explicit confirmation may call this function. The token is a bearer
// credential scoped to one draft; no management session is granted here.
export async function confirmVerification(db,token,now=Date.now()){
  validTime(now);
  if(typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return {verified:false};
  const hash=await hashToken(token);
  try {
  const row=await db.prepare(`UPDATE gear_verification_tokens SET consumed_at=?
    WHERE token_hash=? AND consumed_at IS NULL AND created_at<=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
      WHERE l.id=gear_verification_tokens.listing_id AND l.status='unverified'
        AND l.verified_at IS NULL AND s.email=gear_verification_tokens.email
        AND (SELECT count(*) FROM gear_listings a WHERE a.seller_id=l.seller_id
          AND a.status IN ('available','pending') AND a.expires_at>?)<?)
    RETURNING listing_id`).bind(now,hash,now,now,now,LIMITS.activeListings).first();
  // SQL triggers also enforce the transition and roll back on any failure.
  return row?{verified:true,listingId:row.listing_id}:{verified:false};
  }catch(error){
    const message=String(error.message);
    if(/Active listing limit|Invalid verification transition|UNIQUE constraint failed: gear_listings\.seller_id, gear_listings\.duplicate_key/.test(message))return {verified:false};
    throw error;
  }
}
