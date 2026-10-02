import {isGearImageProviderId} from './gear-image-provider-id.mjs';

const SECRET=/^[0-9a-f]{64}$/;
const CONFLICT_ID='ffffffff-ffff-4fff-8fff-ffffffffffff';
const changes=result=>result?.meta?.changes??result?.changes??0;
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));

function clock(now){if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid photo management timestamp.');}
async function credentials(session,csrf){
  if(typeof session!=='string'||typeof csrf!=='string'||!SECRET.test(session)||!SECRET.test(csrf))return null;
  return {session:await hash(session),csrf:await hash(csrf)};
}
const writeOwner=`SELECT seller_id FROM gear_management_sessions WHERE session_hash=? AND csrf_hash=?
  AND revoked_at IS NULL AND created_at<=? AND expires_at>?`;
const manageable=`l.seller_id=(${writeOwner}) AND l.verified_at IS NOT NULL
  AND l.status IN ('available','pending','closed','expired')`;

async function managedPhotos(db,c,listingId,now){
  const {results}=await db.prepare(`SELECT p.id,p.listing_id AS listingId,p.provider_id AS providerId,p.position,p.created_at AS createdAt
    FROM gear_photos p JOIN gear_listings l ON l.id=p.listing_id
    WHERE p.listing_id=? AND ${manageable} ORDER BY p.position,p.id`)
    .bind(listingId,c.session,c.csrf,now,now).all();
  return results;
}

function snapshotGuard(){
  return `(SELECT count(*) FROM gear_photos WHERE listing_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM gear_photos current WHERE current.listing_id=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) expected
        WHERE json_extract(expected.value,'$.id')=current.id
          AND json_extract(expected.value,'$.providerId')=current.provider_id
          AND json_extract(expected.value,'$.position')=current.position
          AND json_extract(expected.value,'$.createdAt')=current.created_at))`;
}
const snapshotArgs=(listingId,rows)=>[listingId,rows.length,listingId,JSON.stringify(rows)];
const ownerArgs=(c,now)=>[c.session,c.csrf,now,now];

async function replacePhotos(db,c,listingId,rows,nextRows,removed,now){
  const guard=snapshotGuard(),authorization=`EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=? AND ${manageable})`;
  const statements=[db.prepare(`INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at)
    SELECT ?,?,?,-1,0 WHERE NOT (${authorization} AND ${guard})`)
    .bind(CONFLICT_ID,listingId,CONFLICT_ID,listingId,...ownerArgs(c,now),...snapshotArgs(listingId,rows))];
  if(removed)statements.push(db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
    SELECT p.provider_id,p.listing_id,? FROM gear_photos p WHERE p.id=? AND p.listing_id=?
      AND ${authorization} AND ${guard} ON CONFLICT(provider_id) DO NOTHING`)
    .bind(now,removed.id,listingId,listingId,...ownerArgs(c,now),...snapshotArgs(listingId,rows)));
  const deleteIndex=statements.length;
  statements.push(db.prepare(`DELETE FROM gear_photos WHERE listing_id=? AND ${authorization} AND ${guard}`)
    .bind(listingId,listingId,...ownerArgs(c,now),...snapshotArgs(listingId,rows)));
  for(const [position,row] of nextRows.entries())statements.push(db.prepare(`INSERT INTO gear_photos
    (id,listing_id,provider_id,position,created_at) VALUES(?,?,?,?,?)`)
    .bind(row.id,listingId,row.providerId,position,row.createdAt));
  try{
    const results=await db.batch(statements);
    return changes(results[deleteIndex])===rows.length;
  }catch(error){
    if(/(?:UNIQUE constraint failed: gear_photos\.|CHECK constraint failed: position BETWEEN 0 AND 5)/.test(String(error?.message)))return false;
    throw error;
  }
}

export async function removeManagedPhoto(db,session,csrf,listingId,photoId,now=Date.now()){
  clock(now);if(!isGearImageProviderId(listingId)||!isGearImageProviderId(photoId))return false;
  const c=await credentials(session,csrf);if(!c)return false;
  const rows=await managedPhotos(db,c,listingId,now),removed=rows.find(row=>row.id===photoId);
  if(!removed)return false;
  return replacePhotos(db,c,listingId,rows,rows.filter(row=>row.id!==photoId),removed,now);
}

export async function reorderManagedPhotos(db,session,csrf,listingId,photoIds,now=Date.now()){
  clock(now);if(!isGearImageProviderId(listingId)||!Array.isArray(photoIds)||photoIds.length<1||photoIds.length>6
    ||new Set(photoIds).size!==photoIds.length||photoIds.some(id=>!isGearImageProviderId(id)))return false;
  const c=await credentials(session,csrf);if(!c)return false;
  const rows=await managedPhotos(db,c,listingId,now);
  if(rows.length!==photoIds.length)return false;
  const byId=new Map(rows.map(row=>[row.id,row])),ordered=photoIds.map(id=>byId.get(id));
  if(ordered.some(row=>!row))return false;
  if(ordered.every((row,index)=>row.id===rows[index].id))return true;
  return replacePhotos(db,c,listingId,rows,ordered,null,now);
}
