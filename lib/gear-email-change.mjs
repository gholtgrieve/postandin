import { normalizeEmail } from './gear-validation.mjs';
export const EMAIL_CHANGE_TTL_MS=1800000;
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
function clock(now){if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid clock');}
// Trusted local delivery receipt, never returned by the public-shaped POST.
export async function issueLocalEmailChange(db,session,csrf,email,now=Date.now()){
 clock(now);if(!valid(session)||!valid(csrf))return null;
 const target=normalizeEmail(email),token=hex(crypto.getRandomValues(new Uint8Array(32)));
 const row=await db.prepare(`INSERT INTO gear_email_changes
  (seller_id,source_email,target_email,target_id,session_hash,token_hash,created_at,expires_at,consumed_at)
  SELECT s.id,s.email,?,?,?,?,?,?,NULL FROM gear_sellers s JOIN gear_management_sessions m ON m.seller_id=s.id
   WHERE m.session_hash=? AND m.csrf_hash=? AND m.revoked_at IS NULL AND m.created_at<=? AND m.expires_at>?
    AND s.verified_at IS NOT NULL AND s.email!=?
  ON CONFLICT(seller_id) DO UPDATE SET source_email=excluded.source_email,target_email=excluded.target_email,
   target_id=excluded.target_id,session_hash=excluded.session_hash,token_hash=excluded.token_hash,
   created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=NULL
  RETURNING target_email`).bind(target,crypto.randomUUID(),await hash(session),await hash(token),now,now+EMAIL_CHANGE_TTL_MS,
   await hash(session),await hash(csrf),now,now,target).first();
 return row?{recipient:row.target_email,token,delivery:'local-simulation',purpose:'email-change'}:null;
}
export async function confirmEmailChange(db,token,now=Date.now()){
 clock(now);if(!valid(token))return false;
 try{
  const row=await db.prepare(`UPDATE gear_email_changes SET consumed_at=?
   WHERE token_hash=? AND consumed_at IS NULL AND created_at<=? AND expires_at>?
   RETURNING seller_id`).bind(now,await hash(token),now,now).first();
  return Boolean(row);
 }catch(error){
  if(/Invalid email change|Email change listing limit|UNIQUE constraint failed: gear_listings\.seller_id, gear_listings\.duplicate_key/.test(String(error.message)))return false;
  throw error;
 }
}
