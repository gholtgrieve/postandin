import {isGearImageProviderId} from './gear-image-provider-id.mjs';
import {GEAR_QUARANTINE_CLAIM_MS} from './gear-photo-quarantine.mjs';

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
export const GEAR_PHOTO_RECONCILIATION_GRACE_MS=GEAR_DAY_MS;
export const GEAR_PHOTO_RECONCILIATION_PAGE_SIZE=100;
export const GEAR_PHOTO_RECONCILIATION_MAX_PAGES=10;

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
async function withinDeadline(factory,budget,code='photo-delete'){
  if(!budget||budget.remainingMs()===Infinity)return factory();
  const wait=Math.min(GEAR_IMAGE_DELETE_TIMEOUT_MS,budget.remainingMs());if(wait<1)throw new GearMaintenanceError('operation-budget');
  let timer;try{return await Promise.race([factory(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new GearMaintenanceError(code)),wait);})]);}
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
  claim(budget,10);
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
    db.prepare(`DELETE FROM gear_photo_deletions WHERE provider_id IN
      (SELECT provider_id FROM gear_photos UNION SELECT provider_id FROM gear_photo_quarantines
       UNION SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE sanitized_provider_id IS NOT NULL)`).bind(),
    db.prepare('DELETE FROM gear_photo_upload_limits WHERE expires_at<=?').bind(now),
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

const quarantineDue=`(q.sanitized_provider_id IS NOT NULL
  OR (q.claim_hash IS NULL AND q.expires_at<=?)
  OR (q.claim_hash IS NOT NULL AND q.claimed_at<=? AND q.expires_at<=?))`;

async function cleanupPhotoQuarantine(db,providerId,now,claimCutoff,budget){
  claim(budget,3);const dueArgs=()=>[now,claimCutoff,now];
  const results=await db.batch([
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT q.provider_id,q.listing_id,? FROM gear_photo_quarantines q
      WHERE q.provider_id=? AND ${quarantineDue}
        AND NOT EXISTS(SELECT 1 FROM gear_photos WHERE provider_id=q.provider_id)
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,providerId,...dueArgs()),
    db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
      SELECT q.sanitized_provider_id,q.listing_id,? FROM gear_photo_quarantines q
      WHERE q.provider_id=? AND ${quarantineDue} AND q.sanitized_provider_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM gear_photos WHERE provider_id=q.sanitized_provider_id)
      ON CONFLICT(provider_id) DO NOTHING`).bind(now,providerId,...dueArgs()),
    db.prepare(`DELETE FROM gear_photo_quarantines AS q WHERE q.provider_id=? AND ${quarantineDue}
      AND EXISTS(SELECT 1 FROM gear_photo_deletions WHERE provider_id=q.provider_id)
      AND (q.sanitized_provider_id IS NULL
        OR EXISTS(SELECT 1 FROM gear_photo_deletions WHERE provider_id=q.sanitized_provider_id))`)
      .bind(providerId,...dueArgs()),
  ]);
  return changes(results[2])===1;
}

export async function cleanupPhotoQuarantines(db,{now=Date.now(),batchSize=GEAR_CLEANUP_BATCH_SIZE,budget}={}){
  options(now,batchSize,budget);const claimCutoff=now-GEAR_QUARANTINE_CLAIM_MS;
  claim(budget,1);
  const {results}=await db.prepare(`SELECT q.provider_id AS providerId FROM gear_photo_quarantines q
    WHERE ${quarantineDue} ORDER BY coalesce(q.sanitized_at,q.claimed_at,q.expires_at),q.provider_id LIMIT ?`)
    .bind(now,claimCutoff,now,batchSize).all();
  let reconciledQuarantines=0;
  for(const {providerId} of results)if(await cleanupPhotoQuarantine(db,providerId,now,claimCutoff,budget))reconciledQuarantines++;
  return {reconciledQuarantines,batchFull:results.length===batchSize};
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
  const quarantines=await cleanupPhotoQuarantines(db,{now,batchSize,budget});
  const prunedRows=await pruneRows(db,now,budget);
  return {purgedListings,purgedDrafts,prunedRows,reconciledQuarantines:quarantines.reconciledQuarantines,
    batchFull:deletionIds.length===batchSize||draftIds.length===batchSize||quarantines.batchFull};
}

function validListPage(page,pageSize){
  if(!page||!Array.isArray(page.images)||page.images.length>pageSize||typeof page.listComplete!=='boolean')return false;
  if(page.cursor!=null&&(typeof page.cursor!=='string'||page.cursor.length<1||page.cursor.length>2048))return false;
  return page.listComplete||typeof page.cursor==='string';
}

function reconciliationCandidate(image,purpose,cutoff){
  if(!image||!isGearImageProviderId(image.id)||image.requireSignedURLs!==true||image.draft!==false||image.meta?.purpose!==purpose)return null;
  if(purpose==='gear-photo'&&!isGearImageProviderId(image.meta?.source))return null;
  const uploaded=typeof image.uploaded==='string'?Date.parse(image.uploaded):NaN;
  return Number.isSafeInteger(uploaded)&&uploaded>=0&&uploaded<=cutoff?image.id:null;
}

async function referencedProviderIds(db,purpose,ids,budget){
  if(!ids.length)return new Set();claim(budget,1);
  const sql=purpose==='gear-photo'
    ?`SELECT j.value AS providerId FROM json_each(?) j WHERE
       EXISTS(SELECT 1 FROM gear_photos WHERE provider_id=j.value)
       OR EXISTS(SELECT 1 FROM gear_photo_quarantines WHERE sanitized_provider_id=j.value)`
    :`SELECT j.value AS providerId FROM json_each(?) j WHERE
       EXISTS(SELECT 1 FROM gear_photo_quarantines WHERE provider_id=j.value)`;
  const {results}=await db.prepare(sql).bind(JSON.stringify(ids)).all();
  return new Set(results.map(row=>row.providerId));
}

export async function reconcileHostedGearPhotos(db,images,{now=Date.now(),pageSize=GEAR_PHOTO_RECONCILIATION_PAGE_SIZE,maxPages=GEAR_PHOTO_RECONCILIATION_MAX_PAGES,budget,reconciliationCursors={},saveReconciliationCursor}={}){
  options(now,pageSize,budget);
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100||!images?.hosted?.list||!reconciliationCursors||typeof reconciliationCursors!=='object'
    ||(saveReconciliationCursor!==undefined&&typeof saveReconciliationCursor!=='function'))throw new TypeError('Invalid photo reconciliation options.');
  const cutoff=now-GEAR_PHOTO_RECONCILIATION_GRACE_MS,seen=new Set();let reconciledPhotos=0,scanIncomplete=false;
  for(const purpose of ['gear-photo-quarantine','gear-photo']){
    let cursor=reconciliationCursors[purpose],resumed=cursor!=null;
    if(cursor!=null&&(typeof cursor!=='string'||cursor.length<1||cursor.length>2048))throw new TypeError('Invalid photo reconciliation cursor.');
    for(let pageNumber=0;pageNumber<maxPages;pageNumber++){
      let page,listError;
      try{page=await withinDeadline(()=>images.hosted.list({limit:pageSize,cursor,sortOrder:'asc',filter:{metadata:{purpose}}}),budget,'photo-reconcile');}
      catch(error){listError=error instanceof GearMaintenanceError?error:new GearMaintenanceError('photo-reconcile');}
      if(!listError&&!validListPage(page,pageSize))listError=new GearMaintenanceError('photo-reconcile');
      if(listError){
        if(pageNumber===0&&resumed&&listError.code!=='operation-budget'){
          cursor=undefined;resumed=false;pageNumber--;
          if(saveReconciliationCursor){try{await saveReconciliationCursor(purpose,null);}catch{throw new GearMaintenanceError('photo-reconcile');}}
          continue;
        }
        throw listError;
      }
      const ids=[];
      for(const image of page.images){const id=reconciliationCandidate(image,purpose,cutoff);if(id&&!seen.has(id)){seen.add(id);ids.push(id);}}
      const live=await referencedProviderIds(db,purpose,ids,budget),orphans=ids.filter(id=>!live.has(id));
      for(const providerId of orphans){
        if(budget&&!budget.claim(1))throw new GearMaintenanceError('operation-budget');
        const liveGuard=purpose==='gear-photo'
          ?`NOT EXISTS(SELECT 1 FROM gear_photos WHERE provider_id=?)
             AND NOT EXISTS(SELECT 1 FROM gear_photo_quarantines WHERE sanitized_provider_id=?)`
          :'NOT EXISTS(SELECT 1 FROM gear_photo_quarantines WHERE provider_id=?)';
        const guardArgs=purpose==='gear-photo'?[providerId,providerId]:[providerId];
        const result=await db.prepare(`INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at)
          SELECT ?,NULL,? WHERE ${liveGuard}
          ON CONFLICT(provider_id) DO NOTHING`).bind(providerId,now,...guardArgs).run();
        reconciledPhotos+=changes(result);
      }
      cursor=page.listComplete?null:page.cursor;
      if(saveReconciliationCursor){
        try{await saveReconciliationCursor(purpose,cursor);}
        catch{throw new GearMaintenanceError('photo-reconcile');}
      }
      if(page.listComplete)break;
      if(pageNumber===maxPages-1)scanIncomplete=true;
    }
  }
  return {reconciledPhotos,scanIncomplete};
}

export async function deleteQueuedPhotos(db,images,{now=Date.now(),batchSize=GEAR_CLEANUP_BATCH_SIZE,budget,timeReserveMs=0}={}){
  options(now,batchSize,budget);
  if(!Number.isSafeInteger(timeReserveMs)||timeReserveMs<0)throw new TypeError('Invalid maintenance time reserve.');
  claim(budget,1);
  const {results}=await db.prepare(`SELECT provider_id AS providerId FROM gear_photo_deletions d
    WHERE NOT EXISTS(SELECT 1 FROM gear_photos p WHERE p.provider_id=d.provider_id)
      AND NOT EXISTS(SELECT 1 FROM gear_photo_quarantines q
        WHERE q.provider_id=d.provider_id OR q.sanitized_provider_id=d.provider_id)
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
  const total={purgedListings:0,purgedDrafts:0,prunedRows:0,reconciledQuarantines:0,reconciledPhotos:0,deletedPhotos:0};
  let records,photos,reconciliation,photoFailure=false,photoBacklog=false,recordBacklog=false,reconciliationFailure=false,reconciliationBacklog=false;
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
    total.reconciledQuarantines+=records.reconciledQuarantines;
    if(!records.batchFull)break;
  }
  recordBacklog||=records?.batchFull===true;
  if(!recordBacklog){
    try{
      reconciliation=await reconcileHostedGearPhotos(env.GEAR_DB,env.IMAGES,runOptions);
      total.reconciledPhotos+=reconciliation.reconciledPhotos;
    }catch(error){
      if(error instanceof GearMaintenanceError){
        reconciliationBacklog=error.code==='operation-budget';reconciliationFailure=error.code!=='operation-budget';
      }else throw error;
    }
  }
  await drainPhotos(maxPostRecordPhotoBatches);
  if(photoFailure)throw new GearMaintenanceError('photo-delete');
  if(photoBacklog)throw new GearMaintenanceError('photo-backlog');
  if(reconciliationFailure)throw new GearMaintenanceError('photo-reconcile');
  if(reconciliationBacklog)throw new GearMaintenanceError('photo-reconcile-backlog');
  if(recordBacklog)throw new GearMaintenanceError('record-backlog');
  return total;
}
