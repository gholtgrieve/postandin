import {normalizeEmail} from './gear-validation.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROVIDER_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTACT_WINDOW_MS=10*60*1000;
const CONTACT_CLAIM_MS=60000;
export const GEAR_CONTACT_RETENTION_MS=24*60*60*1000;

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const rows=result=>result?.results??[];

export function validateContactSubmission(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!UUID.test(input.id??'')||!UUID.test(input.requestId??'')||typeof input.turnstileToken!=='string')return null;
  const name=typeof input.name==='string'?input.name.trim():'',message=typeof input.message==='string'?input.message.trim():'';
  let email;try{email=normalizeEmail(input.email);}catch{return null;}
  if(!name||name.length>60||/[\x00-\x1f\x7f]/.test(name)||!message||message.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)||input.shareEmail!==true||input.adult!==true)return null;
  return {listingId:input.id,requestId:input.requestId,name,email,message,turnstileToken:input.turnstileToken};
}

function contact(row){return {id:row.id,listingId:row.listing_id,listingTitle:row.listing_title,recipient:row.recipient,buyerName:row.buyer_name,buyerEmail:row.buyer_email,message:row.message,status:row.status,providerId:row.provider_id??null,createdAt:row.created_at,expiresAt:row.expires_at};}

export async function reserveContact(db,input,now=Date.now()){
  let email;try{email=normalizeEmail(input?.email);}catch{throw new TypeError('Invalid contact reservation.');}
  if(!input||!UUID.test(input.listingId??'')||!UUID.test(input.requestId??'')||email!==input.email||typeof input.name!=='string'||!input.name||input.name.length>60||/[\x00-\x1f\x7f]/.test(input.name)||typeof input.message!=='string'||!input.message||input.message.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.message)||!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid contact reservation.');
  const buyerHash=await hash(input.email),inputHash=await hash(JSON.stringify([input.listingId,input.requestId,input.name,input.email,input.message]));
  const results=await db.batch([
    db.prepare(`INSERT INTO gear_contact_attempts(id,listing_id,buyer_hash,input_hash,created_at)
      SELECT ?,?,?,?,? WHERE
        (SELECT count(*) FROM gear_contact_attempts WHERE created_at>?)<60 AND
        (SELECT count(*) FROM gear_contact_attempts WHERE buyer_hash=? AND created_at>?)<5 AND
        (SELECT count(*) FROM gear_contact_attempts WHERE buyer_hash=? AND listing_id=? AND created_at>?)<3
      ON CONFLICT(id) DO NOTHING RETURNING id`).bind(input.requestId,input.listingId,buyerHash,inputHash,now,now-CONTACT_WINDOW_MS,buyerHash,now-CONTACT_WINDOW_MS,buyerHash,input.listingId,now-CONTACT_WINDOW_MS),
    db.prepare(`INSERT INTO gear_contact_messages
      (id,input_hash,listing_id,listing_title,recipient,buyer_name,buyer_email,message,created_at,expires_at)
      SELECT ?,?,l.id,l.title,s.email,?,?,?,?,?
      FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
      WHERE l.id=? AND l.status IN ('available','pending') AND l.verified_at IS NOT NULL
        AND s.verified_at IS NOT NULL AND l.expires_at>?
        AND EXISTS(SELECT 1 FROM gear_contact_attempts WHERE id=? AND input_hash=?)
      ON CONFLICT(id) DO NOTHING RETURNING *`).bind(input.requestId,inputHash,input.name,input.email,input.message,now,now+GEAR_CONTACT_RETENTION_MS,input.listingId,now,input.requestId,inputHash),
  ]);
  const inserted=rows(results[1])[0];if(inserted)return {contact:contact(inserted),replay:false};
  const existing=await db.prepare('SELECT * FROM gear_contact_messages WHERE id=?').bind(input.requestId).first();
  if(existing){
    if(existing.input_hash!==inputHash)return {conflict:true};
    if(existing.expires_at<=now)return {expired:true};
    if(existing.status!=='sent'){
      const current=await db.prepare(`SELECT s.email FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
        WHERE l.id=? AND l.status IN ('available','pending') AND l.verified_at IS NOT NULL
          AND s.verified_at IS NOT NULL AND l.expires_at>?`).bind(input.listingId,now).first();
      if(!current)return {unavailable:true};
      if(current.email!==existing.recipient)return {stale:true};
    }
    return {contact:contact(existing),replay:true};
  }
  const attempt=await db.prepare('SELECT input_hash FROM gear_contact_attempts WHERE id=?').bind(input.requestId).first();
  if(attempt)return attempt.input_hash===inputHash?{unavailable:true}:{conflict:true};
  return {limited:true};
}

export async function claimContactDelivery(db,id,now=Date.now(),token=crypto.randomUUID()){
  if(!UUID.test(id??'')||!UUID.test(token)||!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid contact delivery claim.');
  const claimHash=await hash(token),row=await db.prepare(`UPDATE gear_contact_messages SET status='sending',claim_hash=?,claimed_at=?
    WHERE id=? AND expires_at>? AND (status='pending' OR (status='sending' AND claimed_at<=?))
      AND EXISTS(SELECT 1 FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
        WHERE l.id=gear_contact_messages.listing_id AND l.status IN ('available','pending')
          AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL
          AND l.expires_at>? AND s.email=gear_contact_messages.recipient)
    RETURNING id`).bind(claimHash,now,id,now,now-CONTACT_CLAIM_MS,now).first();
  if(row)return {claimed:true,token};
  const existing=await db.prepare(`SELECT m.status,m.expires_at,m.recipient,
      (SELECT s.email FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
        WHERE l.id=m.listing_id AND l.status IN ('available','pending')
          AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL AND l.expires_at>?) AS current_recipient
    FROM gear_contact_messages m WHERE m.id=?`).bind(now,id).first();
  if(!existing)return {unavailable:true};
  if(existing.expires_at<=now)return {expired:true};
  if(existing.status==='sent')return {sent:true};
  if(!existing.current_recipient)return {unavailable:true};
  if(existing.current_recipient!==existing.recipient)return {stale:true};
  return {busy:true};
}

export async function releaseContactDelivery(db,id,token){
  if(!UUID.test(id??'')||!UUID.test(token??''))throw new TypeError('Invalid contact delivery release.');
  const result=await db.prepare(`UPDATE gear_contact_messages SET status='pending',claim_hash=NULL,claimed_at=NULL
    WHERE id=? AND status='sending' AND claim_hash=?`).bind(id,await hash(token)).run();
  return (result?.meta?.changes??result?.changes??0)===1;
}

export async function markContactSent(db,id,providerId,now=Date.now(),token){
  if(!UUID.test(id??'')||!PROVIDER_ID.test(providerId??'')||!UUID.test(token??'')||!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid contact delivery receipt.');
  const row=await db.prepare(`UPDATE gear_contact_messages SET status='sent',provider_id=?,sent_at=?
      ,claim_hash=NULL,claimed_at=NULL
    WHERE id=? AND status='sending' AND claim_hash=? AND expires_at>?
    RETURNING id`).bind(providerId,now,id,await hash(token),now).first();
  if(row)return true;
  const existing=await db.prepare("SELECT provider_id FROM gear_contact_messages WHERE id=? AND status='sent'").bind(id).first();
  return existing?.provider_id===providerId;
}
