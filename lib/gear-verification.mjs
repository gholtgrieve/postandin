import {GEAR_DRAFT_RETENTION_MS,LIMITS} from './gear-exchange.mjs';
export const TOKEN_TTL_MS=30*60*1000;
export const VERIFICATION_REISSUE_COOLDOWN_MS=60*1000;
export const VERIFICATION_MAX_ISSUES=5;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function hashToken(token){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))));}
function validTime(now){if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid clock');}
const changes=result=>result?.meta?.changes??result?.changes??0;

// Trusted issuance boundary. Public callers must send the receipt only to its
// recorded recipient and must never return the bearer token in an HTTP body.
export async function issueVerification(db,listingId,now=Date.now()){
  validTime(now);
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await hashToken(token);
  const row=await db.prepare(`INSERT INTO gear_verification_tokens
    (listing_id,token_hash,email,created_at,expires_at,consumed_at,issue_count)
    SELECT l.id,?,s.email,?,?,NULL,1 FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL AND l.created_at>?
    ON CONFLICT(listing_id) DO UPDATE SET token_hash=excluded.token_hash,
      email=excluded.email,created_at=excluded.created_at,expires_at=excluded.expires_at,
      consumed_at=NULL,issue_count=gear_verification_tokens.issue_count+1
    WHERE gear_verification_tokens.created_at<=? AND gear_verification_tokens.issue_count<?
    RETURNING email,expires_at`).bind(hash,now,now+TOKEN_TTL_MS,listingId,now-GEAR_DRAFT_RETENTION_MS,now-VERIFICATION_REISSUE_COOLDOWN_MS,VERIFICATION_MAX_ISSUES).first();
  if(row)return {recipient:row.email,token,expiresAt:row.expires_at};
  const state=await db.prepare(`SELECT t.created_at,t.issue_count FROM gear_listings l
    LEFT JOIN gear_verification_tokens t ON t.listing_id=l.id
    WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL AND l.created_at>?`).bind(listingId,now-GEAR_DRAFT_RETENTION_MS).first();
  if(!state)return null;
  if(state.issue_count>=VERIFICATION_MAX_ISSUES)return {limited:true,reason:'cap'};
  if(state.created_at>now-VERIFICATION_REISSUE_COOLDOWN_MS)return {limited:true,reason:'cooldown',retryAfterSeconds:Math.ceil((state.created_at+VERIFICATION_REISSUE_COOLDOWN_MS-now)/1000)};
  throw new Error('Unable to determine verification issuance state.');
}

export async function issueLocalVerification(db,listingId,now=Date.now()){
  validTime(now);
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),hash=await hashToken(token);
  const row=await db.prepare(`INSERT INTO gear_verification_tokens
    (listing_id,token_hash,email,created_at,expires_at,consumed_at)
    SELECT l.id,?,s.email,?,?,NULL FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL
    ON CONFLICT(listing_id) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,
      created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=NULL
    RETURNING email,expires_at`).bind(hash,now,now+TOKEN_TTL_MS,listingId).first();
  const receipt=row?{recipient:row.email,token,expiresAt:row.expires_at}:null;
  return receipt?{...receipt,delivery:'local-simulation'}:null;
}

// A definite pre-delivery rejection must not consume one of the five delivery
// slots or force a one-minute wait. Ambiguous outcomes remain reserved. The
// token-hash guard prevents a delayed failure from rolling back a newer issue.
export async function releaseFailedVerificationIssue(db,listingId,token,now=Date.now()){
  validTime(now);
  if(typeof listingId!=='string'||typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return false;
  const hash=await hashToken(token),priorCreatedAt=Math.max(0,now-VERIFICATION_REISSUE_COOLDOWN_MS);
  const results=await db.batch([
    db.prepare(`DELETE FROM gear_verification_tokens
      WHERE listing_id=? AND token_hash=? AND consumed_at IS NULL AND issue_count=1`).bind(listingId,hash),
    db.prepare(`UPDATE gear_verification_tokens SET issue_count=issue_count-1,
      created_at=?,expires_at=? WHERE listing_id=? AND token_hash=?
      AND consumed_at IS NULL AND issue_count>1`).bind(priorCreatedAt,priorCreatedAt+1,listingId,hash),
  ]);
  return results.some(changes);
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
        AND l.verified_at IS NULL AND l.created_at>? AND s.email=gear_verification_tokens.email
        AND (SELECT count(*) FROM gear_listings a WHERE a.seller_id=l.seller_id
          AND a.status IN ('available','pending') AND a.expires_at>?)<?)
    RETURNING listing_id`).bind(now,hash,now,now,now-GEAR_DRAFT_RETENTION_MS,now,LIMITS.activeListings).first();
  // SQL triggers also enforce the transition and roll back on any failure.
  return row?{verified:true,listingId:row.listing_id}:{verified:false};
  }catch(error){
    const message=String(error.message);
    if(/Active listing limit|Invalid verification transition|UNIQUE constraint failed: gear_listings\.seller_id, gear_listings\.duplicate_key/.test(message))return {verified:false};
    throw error;
  }
}

// Production HTTP confirmation may safely acknowledge a committed response that
// was lost, while the underlying transition remains single-use.
export async function confirmProductionVerification(db,token,now=Date.now()){
  const result=await confirmVerification(db,token,now);
  if(result.verified||typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return result;
  const hash=await hashToken(token);
  const row=await db.prepare(`SELECT t.listing_id FROM gear_verification_tokens t
    JOIN gear_listings l ON l.id=t.listing_id
    WHERE t.token_hash=? AND t.consumed_at IS NOT NULL AND t.expires_at>?
      AND l.verified_at=t.consumed_at AND l.status IN ('available','pending')`).bind(hash,now).first();
  return row?{verified:true,listingId:row.listing_id,alreadyVerified:true}:result;
}
