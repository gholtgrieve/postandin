export const GEAR_DAY_MS=86400000;
export const GEAR_DRAFT_RETENTION_MS=3*GEAR_DAY_MS;
export const GEAR_HISTORY_RETENTION_MS=30*GEAR_DAY_MS;
export const GEAR_DELETION_LEDGER_RETENTION_MS=30*GEAR_DAY_MS;
export const GEAR_CLEANUP_BATCH_SIZE=40;
export const GEAR_MAINTENANCE_INVOCATION_DB_OPERATIONS=900;
export const GEAR_MAINTENANCE_ATTEMPT_DB_OPERATIONS=440;
export const GEAR_MAINTENANCE_DEADLINE_MS=13*60*1000;
export const GEAR_MAINTENANCE_RETRY_MS=60000;
export const GEAR_MAINTENANCE_RECORD_RESERVE_MS=5*60*1000;
export const GEAR_IMAGE_DELETE_TIMEOUT_MS=4000;

export class GearMaintenanceError extends Error{
  constructor(code,details){super('Gear maintenance failed.');this.code=code;this.details=details;}
}
const changes=result=>result?.meta?.changes??result?.changes??0;
function options(now,batchSize,budget){
  if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid cleanup clock.');
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>500)throw new TypeError('Invalid cleanup batch size.');
  if(budget&&typeof budget.claim!=='function')throw new TypeError('Invalid cleanup operation budget.');
}

export function createGearMaintenanceBudget({maxDbOperations=GEAR_MAINTENANCE_INVOCATION_DB_OPERATIONS,deadline=Infinity,clock=Date.now}={}){
  if(!Number.isSafeInteger(maxDbOperations)||maxDbOperations<1)throw new TypeError('Invalid maintenance operation budget.');
  if((deadline!==Infinity&&!Number.isSafeInteger(deadline))||typeof clock!=='function')throw new TypeError('Invalid maintenance deadline.');
  let remaining=maxDbOperations;
  return {
    claim(count){
      if(!Number.isSafeInteger(count)||count<1)throw new TypeError('Invalid maintenance operation count.');
      if(clock()>=deadline||count>remaining)return false;
      remaining-=count;return true;
    },
    expired(){return clock()>=deadline;},
    remainingMs(){return deadline===Infinity?Infinity:Math.max(0,deadline-clock());},
    get remaining(){return remaining;},
  };
}

function attemptBudget(parent,maxDbOperations){
  let remaining=maxDbOperations;
  return {
    claim(count){
      if(count>remaining||!parent.claim(count))return false;
      remaining-=count;return true;
    },
    expired(){return parent.expired();},
    remainingMs(){return parent.remainingMs();},
    get remaining(){return Math.min(remaining,parent.remaining);},
  };
}

function claim(budget,count){if(budget&&!budget.claim(count))throw new GearMaintenanceError('operation-budget');}
async function withinDeadline(factory,budget){
  if(!budget||budget.remainingMs()===Infinity)return factory();
  const wait=Math.min(GEAR_IMAGE_DELETE_TIMEOUT_MS,budget.remainingMs());if(wait<1)throw new GearMaintenanceError('operation-budget');
  let timer;try{return await Promise.race([factory(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new GearMaintenanceError('photo-delete')),wait);})]);}
  finally{clearTimeout(timer);}
}

async function dueIds(db,sql,now,batchSize,budget){
  claim(budget,1);
  const {results}=await db.prepare(sql).bind(now,batchSize).all();return results.map(row=>row.id);
}

async function purgeSellerDeletion(db,id,now,budget){
  const guard=`EXISTS(SELECT 1 FROM gear_deletions d WHERE d.listing_id=? AND d.purge_at<=?)`;
  claim(budget,6);
  const results=await db.batch([
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT provider_id,listing_id,? FROM gear_photos WHERE listing_id=? AND ${guard}
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,id,id,now),
    db.prepare(`DELETE FROM gear_reports WHERE listing_id=? AND ${guard}`).bind(id,id,now),
    db.prepare(`DELETE FROM gear_removals WHERE listing_id=? AND ${guard}`).bind(id,id,now),
    db.prepare(`DELETE FROM gear_moderation_history WHERE listing_id=? AND ${guard}`).bind(id,id,now),
    db.prepare(`DELETE FROM gear_listings WHERE id=? AND ${guard}`).bind(id,id,now),
    db.prepare(`UPDATE gear_deletion_ledger SET purged_at=coalesce(purged_at,?)
      WHERE listing_id=? AND purge_at<=? AND NOT EXISTS(SELECT 1 FROM gear_listings WHERE id=?)`).bind(now,id,now,id),
  ]);
  return changes(results[4])>0;
}

async function purgeDraft(db,id,now,budget){
  const cutoff=now-GEAR_DRAFT_RETENTION_MS;
  const guard=`EXISTS(SELECT 1 FROM gear_listings l WHERE l.id=? AND l.status='unverified' AND l.verified_at IS NULL AND l.created_at<=?)`;
  claim(budget,2);const results=await db.batch([
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT provider_id,listing_id,? FROM gear_photos WHERE listing_id=? AND ${guard}
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,id,id,cutoff),
    db.prepare(`DELETE FROM gear_listings WHERE id=? AND status='unverified' AND verified_at IS NULL AND created_at<=?`).bind(id,cutoff),
  ]);
  return changes(results[1])>0;
}

async function pruneRows(db,now,budget){
  const historyCutoff=now-GEAR_HISTORY_RETENTION_MS,ledgerCutoff=now-GEAR_DELETION_LEDGER_RETENTION_MS;
  claim(budget,8);
  const results=await db.batch([
    db.prepare(`DELETE FROM gear_email_changes WHERE expires_at<=? OR consumed_at IS NOT NULL
      OR session_hash IN (SELECT session_hash FROM gear_management_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL)`).bind(now,now),
    db.prepare('DELETE FROM gear_management_links WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(now),
    db.prepare('DELETE FROM gear_management_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL').bind(now),
    db.prepare('DELETE FROM gear_verification_tokens WHERE expires_at<=? OR consumed_at IS NOT NULL').bind(now),
    db.prepare('DELETE FROM gear_reports WHERE created_at<=?').bind(historyCutoff),
    db.prepare('DELETE FROM gear_moderation_history WHERE created_at<=?').bind(historyCutoff),
    db.prepare(`UPDATE gear_removals SET reason='Removal remains in effect; original reason expired.'
      WHERE removed_at<=? AND reason!='Removal remains in effect; original reason expired.'`).bind(historyCutoff),
    db.prepare('DELETE FROM gear_deletion_ledger WHERE purged_at IS NOT NULL AND purged_at<=?').bind(ledgerCutoff),
  ]);
  claim(budget,4);const orphanResults=await db.batch([
    db.prepare(`DELETE FROM gear_email_changes WHERE seller_id IN
      (SELECT id FROM gear_sellers WHERE NOT EXISTS(SELECT 1 FROM gear_listings WHERE seller_id=gear_sellers.id))`).bind(),
    db.prepare(`DELETE FROM gear_management_links WHERE seller_id IN
      (SELECT id FROM gear_sellers WHERE NOT EXISTS(SELECT 1 FROM gear_listings WHERE seller_id=gear_sellers.id))`).bind(),
    db.prepare(`DELETE FROM gear_management_sessions WHERE seller_id IN
      (SELECT id FROM gear_sellers WHERE NOT EXISTS(SELECT 1 FROM gear_listings WHERE seller_id=gear_sellers.id))`).bind(),
    db.prepare('DELETE FROM gear_sellers WHERE NOT EXISTS(SELECT 1 FROM gear_listings WHERE seller_id=gear_sellers.id)').bind(),
  ]);
  return [...results,...orphanResults].reduce((total,result)=>total+changes(result),0);
}

export async function cleanupGearRecords(db,{now=Date.now(),batchSize=GEAR_CLEANUP_BATCH_SIZE,budget}={}){
  options(now,batchSize,budget);
  const deletionIds=await dueIds(db,`SELECT listing_id AS id FROM gear_deletions
    WHERE purge_at<=? ORDER BY purge_at,listing_id LIMIT ?`,now,batchSize,budget);
  const draftIds=await dueIds(db,`SELECT id FROM gear_listings
    WHERE status='unverified' AND verified_at IS NULL AND created_at<=?
    ORDER BY created_at,id LIMIT ?`,now-GEAR_DRAFT_RETENTION_MS,batchSize,budget);
  let purgedListings=0,purgedDrafts=0;
  for(const id of deletionIds)if(await purgeSellerDeletion(db,id,now,budget))purgedListings++;
  for(const id of draftIds)if(await purgeDraft(db,id,now,budget))purgedDrafts++;
  const prunedRows=await pruneRows(db,now,budget);
  return {purgedListings,purgedDrafts,prunedRows,batchFull:deletionIds.length===batchSize||draftIds.length===batchSize};
}

export async function deleteQueuedPhotos(db,images,{now=Date.now(),batchSize=GEAR_CLEANUP_BATCH_SIZE,budget,timeReserveMs=0}={}){
  options(now,batchSize,budget);
  if(!Number.isSafeInteger(timeReserveMs)||timeReserveMs<0)throw new TypeError('Invalid maintenance time reserve.');
  claim(budget,1);
  const {results}=await db.prepare(`SELECT provider_id AS providerId FROM gear_photo_deletions
    ORDER BY attempts,queued_at,provider_id LIMIT ?`).bind(batchSize).all();
  let deletedPhotos=0,failedPhotos=0,budgetFull=false;
  for(const {providerId} of results){
    if(budget&&budget.remainingMs()<=timeReserveMs){budgetFull=true;break;}
    if(budget&&!budget.claim(1)){budgetFull=true;break;}
    let imageDeleted=false;
    try{
      await withinDeadline(()=>images.hosted.image(providerId).delete(),budget);imageDeleted=true;
      await db.prepare('DELETE FROM gear_photo_deletions WHERE provider_id=?').bind(providerId).run();
      deletedPhotos++;
    }catch{
      failedPhotos++;
      if(imageDeleted&&budget&&!budget.claim(1)){budgetFull=true;break;}
      await db.prepare(`UPDATE gear_photo_deletions SET attempts=attempts+1,last_attempt_at=?
        WHERE provider_id=?`).bind(now,providerId).run();
    }
  }
  const details={deletedPhotos,failedPhotos,batchFull:budgetFull||results.length===batchSize};
  if(budgetFull)throw new GearMaintenanceError('operation-budget',details);
  if(failedPhotos)throw new GearMaintenanceError('photo-delete',details);
  return details;
}

export async function runGearMaintenance(env,{maxRecordBatches=1,maxPhotoBatches=2,maxPostRecordPhotoBatches=10,maxDbOperations=GEAR_MAINTENANCE_ATTEMPT_DB_OPERATIONS,budget,...options}={}){
  if(!Number.isSafeInteger(maxRecordBatches)||maxRecordBatches<1||maxRecordBatches>100||!Number.isSafeInteger(maxPhotoBatches)||maxPhotoBatches<1||maxPhotoBatches>100||!Number.isSafeInteger(maxPostRecordPhotoBatches)||maxPostRecordPhotoBatches<1||maxPostRecordPhotoBatches>100)throw new TypeError('Invalid cleanup batch limit.');
  if(!Number.isSafeInteger(maxDbOperations)||maxDbOperations<1||maxDbOperations>GEAR_MAINTENANCE_INVOCATION_DB_OPERATIONS)throw new TypeError('Invalid cleanup operation limit.');
  const shared=budget??createGearMaintenanceBudget({maxDbOperations}),scoped=attemptBudget(shared,maxDbOperations),runOptions={...options,budget:scoped},pageSize=options.batchSize??GEAR_CLEANUP_BATCH_SIZE;
  const total={purgedListings:0,purgedDrafts:0,prunedRows:0,deletedPhotos:0};
  let records,photos,photoFailure=false,photoBacklog=false,recordBacklog=false;
  async function drainPhotos(maxBatches){
    for(let batch=0;batch<maxBatches;batch++){
      const batchSize=Math.min(pageSize,Math.max(1,scoped.remaining-1));
      try{photos=await deleteQueuedPhotos(env.GEAR_DB,env.IMAGES,{...runOptions,batchSize,timeReserveMs:GEAR_MAINTENANCE_RECORD_RESERVE_MS});}
      catch(error){
        if(error instanceof GearMaintenanceError&&(error.code==='photo-delete'||error.code==='operation-budget')){
          photos=error.details??{deletedPhotos:0,batchFull:true};photoFailure||=error.code==='photo-delete';photoBacklog=error.code==='operation-budget'||photos.batchFull;
        }else throw error;
      }
      total.deletedPhotos+=photos.deletedPhotos;
      if(photos.deletedPhotos===0&&photos.failedPhotos>0)break;
      if(!photos.batchFull){photoBacklog=false;break;}
      photoBacklog=true;
      if(scoped.remaining<2||scoped.remainingMs()<=GEAR_MAINTENANCE_RECORD_RESERVE_MS)break;
    }
  }
  await drainPhotos(maxPhotoBatches);
  for(let batch=0;batch<maxRecordBatches;batch++){
    try{records=await cleanupGearRecords(env.GEAR_DB,runOptions);}
    catch(error){if(error instanceof GearMaintenanceError&&error.code==='operation-budget'){recordBacklog=true;break;}throw error;}
    total.purgedListings+=records.purgedListings;total.purgedDrafts+=records.purgedDrafts;total.prunedRows+=records.prunedRows;
    if(!records.batchFull)break;
  }
  recordBacklog||=records?.batchFull===true;
  await drainPhotos(maxPostRecordPhotoBatches);
  if(photoFailure)throw new GearMaintenanceError('photo-delete');
  if(photoBacklog)throw new GearMaintenanceError('photo-backlog');
  if(recordBacklog)throw new GearMaintenanceError('record-backlog');
  return total;
}
