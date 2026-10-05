const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SECRET=/^[a-f0-9]{64}$/;
const ACTIVE_LIMIT=10;
export const SELLER_RECOVERY_MS=30*86400000;

const changes=result=>result?.meta?.changes??result?.changes??0;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');

function validClock(now,withDeadline=false){
  if(!Number.isSafeInteger(now)||now<0||(withDeadline&&!Number.isSafeInteger(now+SELLER_RECOVERY_MS)))throw new TypeError('Invalid seller deletion timestamp.');
}

async function credentials(session,csrf){
  if(typeof session!=='string'||typeof csrf!=='string'||!SECRET.test(session)||!SECRET.test(csrf))return null;
  return {session:await hash(session),csrf:await hash(csrf)};
}

const ownerSQL=`SELECT seller_id FROM gear_management_sessions
  WHERE session_hash=? AND csrf_hash=? AND revoked_at IS NULL
    AND created_at<=? AND expires_at>?`;
const scopedOwnerSQL=`${ownerSQL} AND (listing_id IS NULL OR listing_id=l.id)`;

export function validateSellerDeletionAction(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['delete','recover'].includes(input.action)||typeof input.id!=='string'||!UUID.test(input.id))return null;
  return {action:input.action,id:input.id};
}

async function access(db,c,now){
  return Boolean(await db.prepare(ownerSQL).bind(c.session,c.csrf,now,now).first());
}

function deleteStatements(db,c,id,now){
  const purgeAt=now+SELLER_RECOVERY_MS;
  return [
    db.prepare(`INSERT INTO gear_deletions(listing_id,previous_status,deleted_at,purge_at)
      SELECT l.id,l.status,?,? FROM gear_listings l
      WHERE l.id=? AND l.seller_id=(${scopedOwnerSQL}) AND l.verified_at IS NOT NULL
        AND l.status IN ('available','pending','closed','expired','removed')
        AND NOT EXISTS(SELECT 1 FROM gear_deletions d WHERE d.listing_id=l.id)
      RETURNING listing_id`).bind(now,purgeAt,id,c.session,c.csrf,now,now),
    db.prepare(`INSERT INTO gear_deletion_ledger(listing_id,deleted_at,purge_at,purged_at)
      SELECT d.listing_id,d.deleted_at,d.purge_at,NULL FROM gear_deletions d
      JOIN gear_listings l ON l.id=d.listing_id
      WHERE d.listing_id=? AND d.deleted_at=? AND d.purge_at=?
        AND l.seller_id=(${scopedOwnerSQL})
      RETURNING listing_id`).bind(id,now,purgeAt,c.session,c.csrf,now,now),
    db.prepare(`UPDATE gear_listings SET status='removed'
      WHERE id=? AND seller_id=(${ownerSQL} AND (listing_id IS NULL OR listing_id=gear_listings.id)) AND verified_at IS NOT NULL
        AND status=(SELECT previous_status FROM gear_deletions WHERE listing_id=gear_listings.id)
        AND EXISTS(SELECT 1 FROM gear_deletion_ledger x
          WHERE x.listing_id=gear_listings.id AND x.deleted_at=? AND x.purge_at=? AND x.purged_at IS NULL)
      RETURNING id`).bind(id,c.session,c.csrf,now,now,now,purgeAt),
  ];
}

function recoverStatements(db,c,id,now){
  const eligible=`l.id=? AND l.status='removed' AND d.purge_at>?
    AND s.id=l.seller_id AND l.seller_id=(${scopedOwnerSQL}) AND l.verified_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM gear_deletion_ledger ledger
      WHERE ledger.listing_id=d.listing_id AND ledger.deleted_at=d.deleted_at
        AND ledger.purge_at=d.purge_at AND ledger.purged_at IS NULL)
    AND (d.previous_status NOT IN ('available','pending') OR l.expires_at<=? OR (
      s.verified_at IS NOT NULL
      AND (SELECT count(*) FROM gear_listings active WHERE active.seller_id=l.seller_id
        AND active.status IN ('available','pending') AND active.expires_at>?)<${ACTIVE_LIMIT}
      AND NOT EXISTS(SELECT 1 FROM gear_listings duplicate WHERE duplicate.id!=l.id
        AND duplicate.seller_id=l.seller_id AND duplicate.duplicate_key=l.duplicate_key
        AND duplicate.status IN ('available','pending') AND duplicate.expires_at>?)))`;
  const eligibilityArgs=()=>[id,now,c.session,c.csrf,now,now,now,now,now];
  return [
    db.prepare(`UPDATE gear_listings SET status='expired'
      WHERE id!=? AND status IN ('available','pending') AND expires_at<=?
        AND seller_id=(SELECT seller_id FROM gear_listings WHERE id=?)
        AND duplicate_key=(SELECT duplicate_key FROM gear_listings WHERE id=?)
        AND EXISTS(SELECT 1 FROM gear_listings l
          JOIN gear_sellers s ON s.id=l.seller_id
          JOIN gear_deletions d ON d.listing_id=l.id
          WHERE ${eligible} AND d.previous_status IN ('available','pending') AND l.expires_at>?)`)
      .bind(id,now,id,id,...eligibilityArgs(),now),
    db.prepare(`UPDATE gear_listings AS l SET status=CASE
        WHEN (SELECT previous_status FROM gear_deletions WHERE listing_id=l.id) IN ('available','pending') AND l.expires_at<=? THEN 'expired'
        ELSE (SELECT previous_status FROM gear_deletions WHERE listing_id=l.id) END
      WHERE l.id=? AND EXISTS(SELECT 1 FROM gear_sellers s JOIN gear_deletions d ON d.listing_id=l.id
        WHERE ${eligible})
      RETURNING id`).bind(now,id,...eligibilityArgs()),
    db.prepare(`DELETE FROM gear_deletion_ledger
      WHERE listing_id=? AND purged_at IS NULL
        AND EXISTS(SELECT 1 FROM gear_deletions d JOIN gear_listings l ON l.id=d.listing_id
          WHERE d.listing_id=gear_deletion_ledger.listing_id
            AND d.deleted_at=gear_deletion_ledger.deleted_at AND d.purge_at=gear_deletion_ledger.purge_at
            AND d.purge_at>? AND l.seller_id=(${scopedOwnerSQL})
            AND l.status=CASE
              WHEN d.previous_status IN ('available','pending') AND l.expires_at<=? THEN 'expired'
              ELSE d.previous_status END)
      RETURNING listing_id`).bind(id,now,c.session,c.csrf,now,now,now),
    db.prepare(`DELETE FROM gear_deletions
      WHERE listing_id=? AND purge_at>?
        AND NOT EXISTS(SELECT 1 FROM gear_deletion_ledger ledger
          WHERE ledger.listing_id=gear_deletions.listing_id AND ledger.purged_at IS NULL)
        AND EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=gear_deletions.listing_id
          AND l.seller_id=(${scopedOwnerSQL})
          AND l.status=CASE
            WHEN gear_deletions.previous_status IN ('available','pending') AND l.expires_at<=? THEN 'expired'
            ELSE gear_deletions.previous_status END)
      RETURNING listing_id`).bind(id,now,c.session,c.csrf,now,now,now),
  ];
}

export async function changeSellerDeletion(db,session,csrf,input,now=Date.now()){
  validClock(now,input?.action==='delete');
  const action=validateSellerDeletionAction(input);
  if(!action)throw new TypeError('Invalid seller deletion action.');
  const c=await credentials(session,csrf);
  if(!c||!await access(db,c,now))return {ok:false,reason:'access'};
  const statements=action.action==='delete'?deleteStatements(db,c,action.id,now):recoverStatements(db,c,action.id,now);
  try{
    const results=await db.batch(statements);
    const primary=action.action==='delete'?0:1;
    if(changes(results[primary])===0)return {ok:false,reason:'conflict'};
    const required=action.action==='delete'?[0,1,2]:[1,2,3];
    // D1 has committed when batch resolves. The predicates above make this a
    // diagnostic alarm for a future broken invariant, not a rollback guard.
    if(required.some(index=>changes(results[index])!==1))throw new Error('Seller deletion transaction invariant failed.');
    return {ok:true};
  }catch(error){
    if(/UNIQUE constraint failed: gear_(?:deletions|deletion_ledger)\.listing_id/.test(String(error?.message)))return {ok:false,reason:'conflict'};
    throw error;
  }
}
