import { validateDraft } from './gear-validation.mjs';
import { duplicateKey } from './gear-duplicates.mjs';
import { LIMITS } from './gear-exchange.mjs';
export const MANAGEMENT_TTL_MS=86400000;
export const RECOVERY_TTL_MS=1800000;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
// Derive a stable CSRF secret from the HttpOnly session, never from its stored hash.
const sessionCSRF=session=>hash('gear-management-csrf-v1:'+session);
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function clock(now){if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid clock');}
// The caller owns delivery. Public HTTP recovery must never return this receipt.
export async function issueManagementLink(db,email,now=Date.now()){
 clock(now);if(typeof email!=='string'||email.length>254)return null;
 const token=random();
 const row=await db.prepare(`INSERT INTO gear_management_links
  (seller_id,token_hash,email,created_at,expires_at,consumed_at,session_hash,csrf_hash)
  SELECT id,?,email,?,?,NULL,NULL,NULL FROM gear_sellers
  WHERE email=? AND verified_at IS NOT NULL
  ON CONFLICT(seller_id) DO UPDATE SET token_hash=excluded.token_hash,email=excluded.email,
    created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=NULL,session_hash=NULL,csrf_hash=NULL
  RETURNING email`).bind(await hash(token),now,now+RECOVERY_TTL_MS,email.trim().toLowerCase()).first();
 return row?{recipient:row.email,token}:null;
}
// Trusted simulated delivery used only by the local development server/tests.
export async function issueLocalManagementLink(db,email,now=Date.now()){
 const receipt=await issueManagementLink(db,email,now);
 return receipt?{...receipt,delivery:'local-simulation'}:null;
}
export async function redeemManagementLink(db,token,now=Date.now()){
 clock(now);if(!valid(token))return null;
 const session=random(),csrf=await sessionCSRF(session);
 const row=await db.prepare(`UPDATE gear_management_links SET consumed_at=?,session_hash=?,csrf_hash=?
  WHERE token_hash=? AND consumed_at IS NULL AND created_at<=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM gear_sellers s WHERE s.id=gear_management_links.seller_id
      AND s.email=gear_management_links.email AND s.verified_at IS NOT NULL)
  RETURNING seller_id`).bind(now,await hash(session),await hash(csrf),await hash(token),now,now).first();
 return row?{session,csrf,expiresAt:now+MANAGEMENT_TTL_MS}:null;
}
// Same-origin POST bootstrap after reload. Does not renew or create a session.
// Legacy random CSRF is replaced once; subsequent tabs receive the same value.
export async function recoverManagementSession(db,session,now=Date.now()){
 clock(now);if(!valid(session))return null;
 const csrf=await sessionCSRF(session);
 const row=await db.prepare(`UPDATE gear_management_sessions SET csrf_hash=?
  WHERE session_hash=? AND revoked_at IS NULL AND created_at<=? AND expires_at>?
  RETURNING expires_at`).bind(await hash(csrf),await hash(session),now,now).first();
 return row?{csrf,expiresAt:row.expires_at}:null;
}
// Resolve identity from a credential, never a client-supplied sellerId.
async function credentials(session,csrf=null){
 if(!valid(session)||(csrf!==null&&!valid(csrf)))return null;
 return {session:await hash(session),csrf:csrf===null?null:await hash(csrf)};
}
const sessionSQL=`SELECT seller_id FROM gear_management_sessions
 WHERE session_hash=? AND revoked_at IS NULL AND created_at<=? AND expires_at>?`;
function managedListingsStatement(db,c,now,includePhotoRefs,excludeSellerDeleted){
 const photoColumn=includePhotoRefs?`,(SELECT json_group_array(json_object('id',id,'providerId',provider_id))
   FROM (SELECT id,provider_id FROM gear_photos WHERE listing_id=l.id ORDER BY position,id)) AS photoRefs`:'';
 return db.prepare(`SELECT l.id,l.title,l.description,l.category,l.size,l.fit,l.condition,l.city,
  l.type,l.price_cents AS priceCents,l.trade,l.other_club AS otherClub,l.seller_name AS sellerName,
  CASE WHEN l.status IN ('available','pending') AND l.expires_at<=? THEN 'expired' ELSE l.status END AS status,
  l.expires_at AS expiresAt,(SELECT json_group_array(club) FROM
    (SELECT club FROM gear_listing_clubs WHERE listing_id=l.id ORDER BY club)) AS clubs${photoColumn}
  FROM gear_listings l WHERE l.seller_id=( ${sessionSQL} ) AND l.verified_at IS NOT NULL
    AND l.status!='unverified'
    ${excludeSellerDeleted?'AND NOT EXISTS(SELECT 1 FROM gear_deletions d WHERE d.listing_id=l.id)':''}
    ORDER BY l.created_at DESC,l.id LIMIT 100`).bind(now,c.session,now,now);
}
function managedDeletionsStatement(db,c,now){
 return db.prepare(`SELECT l.id,l.title,d.deleted_at AS deletedAt,d.purge_at AS purgeAt
   FROM gear_deletions d JOIN gear_listings l ON l.id=d.listing_id
   WHERE l.seller_id=(${sessionSQL}) AND l.status='removed'
     AND EXISTS(SELECT 1 FROM gear_deletion_ledger x WHERE x.listing_id=d.listing_id
       AND x.deleted_at=d.deleted_at AND x.purge_at=d.purge_at AND x.purged_at IS NULL)
   ORDER BY d.deleted_at DESC,l.id LIMIT 100`).bind(c.session,now,now);
}
const projectManaged=(results,includePhotoRefs)=>results.map(r=>({...r,clubs:JSON.parse(r.clubs),...(includePhotoRefs?{photoRefs:JSON.parse(r.photoRefs)}:{})}));
async function managedListings(db,session,now,includePhotoRefs,excludeSellerDeleted){
 clock(now);const c=await credentials(session);if(!c)return null;
 const owner=await db.prepare(sessionSQL).bind(c.session,now,now).first();if(!owner)return null;
 const {results}=await managedListingsStatement(db,c,now,includePhotoRefs,excludeSellerDeleted).all();
 return projectManaged(results,includePhotoRefs);
}
export async function listManaged(db,session,now=Date.now()){
 return managedListings(db,session,now,false,false);
}
export async function listManagedWithPhotoRefs(db,session,now=Date.now()){
 return managedListings(db,session,now,true,true);
}
export async function listManagedDeletions(db,session,now=Date.now()){
 clock(now);const c=await credentials(session);if(!c)return null;
 const owner=await db.prepare(sessionSQL).bind(c.session,now,now).first();if(!owner)return null;
 const {results}=await managedDeletionsStatement(db,c,now).all();
 return results;
}
export async function readManagedSnapshotWithPhotoRefs(db,session,now=Date.now()){
 clock(now);const c=await credentials(session);if(!c)return null;
 const results=await db.batch([
  db.prepare(`SELECT 1 AS allowed WHERE EXISTS(${sessionSQL})`).bind(c.session,now,now),
  managedListingsStatement(db,c,now,true,true),
  managedDeletionsStatement(db,c,now),
 ]);
 if(!results[0].results?.length)return null;
 return {listings:projectManaged(results[1].results??[],true),deleted:results[2].results??[]};
}
// Rechecked inside each write, including CSRF hash and ownership.
const writeOwner=`SELECT seller_id FROM gear_management_sessions WHERE session_hash=? AND csrf_hash=?
 AND revoked_at IS NULL AND created_at<=? AND expires_at>?`;
// Clear only this owner's expired matches in the same transaction as the write.
// This also works on long-running servers without relying on startup cleanup.
function staleMatches(db,c,id,key,now){
 return db.prepare(`UPDATE gear_listings SET status='expired'
  WHERE seller_id=(${writeOwner}) AND id!=? AND status IN ('available','pending') AND expires_at<=?
    AND duplicate_key=${key===null?'(SELECT duplicate_key FROM gear_listings WHERE id=?)':'?'}
    AND EXISTS(SELECT 1 FROM gear_listings target WHERE target.id=?
      AND target.seller_id=gear_listings.seller_id AND target.verified_at IS NOT NULL
      AND target.status IN ('available','pending','closed','expired'))`)
  .bind(c.session,c.csrf,now,now,id,now,key===null?id:key,id);
}
async function managedWrite(db,cleanup,write){
 const results=await db.batch([cleanup,write]);
 // The local SQLite adapter uses changes; D1 uses meta.changes.
 return (results[1].meta?.changes??results[1].changes)>0;
}
export async function revokeManagement(db,session,csrf,now=Date.now()){
 clock(now);const c=await credentials(session,csrf);if(!c||c.csrf===null)return false;
 const row=await db.prepare(`UPDATE gear_management_sessions SET revoked_at=?
  WHERE session_hash=? AND csrf_hash=? AND revoked_at IS NULL AND created_at<=? AND expires_at>?
  RETURNING seller_id`).bind(now,c.session,c.csrf,now,now).first();return Boolean(row);
}
export async function changeListingState(db,session,csrf,id,action,now=Date.now()){
 clock(now);const c=await credentials(session,csrf);if(!c||c.csrf===null)return false;
 const targets={pending:'pending',available:'available',close:'closed',relist:'available'};
 if(typeof id!=='string'||!Object.hasOwn(targets,action))return false;
 const target=targets[action];
 const relist=action==='relist';
 const allowed=relist?`(status IN ('closed','expired') OR (status IN ('available','pending') AND expires_at<=?))`
   :action==='close'?`status IN ('available','pending','expired')`:`status IN ('available','pending') AND expires_at>?`;
 const args=[target,...(relist?[now+LIMITS.durationDays*86400000]:[]),id,c.session,c.csrf,now,now,...(action==='close'?[]:[now]),...(relist?[now,LIMITS.activeListings]:[])];
 try{
  const write=db.prepare(`UPDATE gear_listings SET status=?${relist?',expires_at=?':''}
   WHERE id=? AND seller_id=(${writeOwner}) AND verified_at IS NOT NULL AND ${allowed}
   ${relist?`AND (SELECT count(*) FROM gear_listings a WHERE a.seller_id=gear_listings.seller_id
     AND a.status IN ('available','pending') AND a.expires_at>?)<?`:''}
   RETURNING id`).bind(...args);
  if(relist)return await managedWrite(db,staleMatches(db,c,id,null,now),write);
  return Boolean(await write.first());
 }catch(error){if(/UNIQUE constraint failed: gear_listings\.seller_id, gear_listings\.duplicate_key/.test(String(error.message)))return false;throw error;}
}
export async function editManagedListing(db,session,csrf,id,input,now=Date.now()){
 clock(now);const c=await credentials(session,csrf);if(!c||c.csrf===null)return false;
 if(typeof id!=='string')return false;
 // Ignore attempts to change owner/status/timestamps. Email changes are not
 // accepted here; use the separate verified email-change flow.
 const owner=await db.prepare(`SELECT s.email FROM gear_sellers s WHERE s.id=(${writeOwner})`).bind(c.session,c.csrf,now,now).first();
 if(!owner||!input||typeof input!=='object'||Array.isArray(input))return false;
 if(Object.hasOwn(input,'email')&&(typeof input.email!=='string'||input.email.trim().toLowerCase()!==owner.email))return false;
 const d=validateDraft({...input,email:owner.email,adult:true});
 try{
  const write=db.prepare(`UPDATE gear_listings SET seller_name=?,title=?,description=?,category=?,size=?,fit=?,condition=?,city=?,
   type=?,price_cents=?,trade=?,other_club=?,duplicate_key=?,management_clubs=?
   WHERE id=? AND seller_id=(${writeOwner}) AND verified_at IS NOT NULL AND status IN ('available','pending','closed','expired') RETURNING id`)
   .bind(d.sellerName,d.title,d.description,d.category,d.size,d.fit,d.condition,d.city,d.type,d.priceCents,d.trade,d.otherClub,duplicateKey(d),JSON.stringify(d.clubs),id,c.session,c.csrf,now,now);
  return await managedWrite(db,staleMatches(db,c,id,duplicateKey(d),now),write);
 }catch(error){if(/UNIQUE constraint failed: gear_listings\.seller_id, gear_listings\.duplicate_key/.test(String(error.message)))return false;throw error;}
}
