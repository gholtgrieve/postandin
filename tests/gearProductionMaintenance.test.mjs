import test from 'node:test';
import assert from 'node:assert/strict';
import {createGearMaintenanceWorker,runScheduledGearMaintenance} from '../gear-maintenance/src/index.js';
import {GearMaintenanceAlertError,sendMaintenanceAlert} from '../lib/gear-maintenance-alert.mjs';
import {createGearMaintenanceBudget,GEAR_DAY_MS,GEAR_MAINTENANCE_RETRY_MS,GearMaintenanceError,cleanupGearRecords,deleteQueuedPhotos,runGearMaintenance} from '../lib/gear-maintenance.mjs';
import {recordHostedPhoto} from '../lib/gear-photo-storage.mjs';
import {submitReport} from '../lib/gear-report-storage.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification} from '../lib/gear-verification.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const sample={title:'Bag',description:'Sample wear',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
const providerId='00000000-0000-4000-8000-000000000001';
const responseId='01234567-89ab-4cde-8fab-0123456789ab';
async function publish(db,now=100){const draft=await createDraft(db,sample,now),receipt=await issueLocalVerification(db,draft.id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return draft.id;}
const count=(db,table)=>db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

test('due seller purge durably queues hosted photos before deleting records and retaining the ledger',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),reportId=crypto.randomUUID();await recordHostedPhoto(db,id,providerId,110);await submitReport(db,{listingId:id,reason:'Other concern'},120,reportId);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
    db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'available',130,200);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,130,200);
    const result=await cleanupGearRecords(db,{now:200});assert.equal(result.purgedListings,1);assert.equal(result.batchFull,false);
    assert.equal(count(db,'gear_listings'),0);assert.equal(count(db,'gear_photos'),0);assert.equal(count(db,'gear_reports'),0);assert.equal(count(db,'gear_deletions'),0);
    assert.deepEqual({...db.sqlite.prepare('SELECT provider_id,listing_id,queued_at,attempts,last_attempt_at FROM gear_photo_deletions').get()},{provider_id:providerId,listing_id:id,queued_at:200,attempts:0,last_attempt_at:null});
    assert.equal(db.sqlite.prepare('SELECT purged_at FROM gear_deletion_ledger').get().purged_at,200);assert.equal(count(db,'gear_sellers'),0);
  }finally{db.close();}
});

test('photo deletion retries safely, records no private error and treats an already-missing image as success',async()=>{
  const db=openLocalDatabase();try{
    db.sqlite.prepare('INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at) VALUES(?,?,?)').run(providerId,crypto.randomUUID(),100);
    const failing={hosted:{image:id=>({delete:async()=>{assert.equal(id,providerId);throw new Error('private provider detail');}})}};
    await assert.rejects(deleteQueuedPhotos(db,failing,{now:200}),error=>error instanceof GearMaintenanceError&&error.code==='photo-delete'&&!error.message.includes('private'));
    assert.deepEqual({...db.sqlite.prepare('SELECT attempts,last_attempt_at FROM gear_photo_deletions').get()},{attempts:1,last_attempt_at:200});
    const missing={hosted:{image:id=>({delete:async()=>{assert.equal(id,providerId);return false;}})}};
    assert.deepEqual(await deleteQueuedPhotos(db,missing,{now:201}),{deletedPhotos:1,failedPhotos:0,batchFull:false});assert.equal(count(db,'gear_photo_deletions'),0);
  }finally{db.close();}
});

test('seller recovery winning the race leaves listing, reports and photos untouched',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),reportId=crypto.randomUUID();await recordHostedPhoto(db,id,providerId,110);await submitReport(db,{listingId:id,reason:'Other concern'},120,reportId);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'available',130,200);db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,130,200);
    let raced=false;const wrapper={prepare:(...args)=>db.prepare(...args),batch:async statements=>{if(!raced){raced=true;db.sqlite.prepare("UPDATE gear_listings SET status='available' WHERE id=?").run(id);db.sqlite.prepare('DELETE FROM gear_deletions WHERE listing_id=?').run(id);db.sqlite.prepare('DELETE FROM gear_deletion_ledger WHERE listing_id=?').run(id);}return db.batch(statements);}};
    const result=await cleanupGearRecords(wrapper,{now:200});assert.equal(result.purgedListings,0);assert.equal(count(db,'gear_listings'),1);assert.equal(count(db,'gear_photos'),1);assert.equal(count(db,'gear_reports'),1);assert.equal(count(db,'gear_photo_deletions'),0);
  }finally{db.close();}
});

test('outbox failure rolls back listing, photo, report, marker and ledger changes',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),reportId=crypto.randomUUID();await recordHostedPhoto(db,id,providerId,110);await submitReport(db,{listingId:id,reason:'Other concern'},120,reportId);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'available',130,200);db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,130,200);
    const tables=['gear_listings','gear_photos','gear_reports','gear_deletions','gear_deletion_ledger','gear_photo_deletions'],snapshot=()=>JSON.stringify(tables.map(table=>db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),before=snapshot();
    db.sqlite.exec("CREATE TRIGGER fail_photo_outbox BEFORE INSERT ON gear_photo_deletions BEGIN SELECT RAISE(ABORT,'private queue failure'); END");
    await assert.rejects(cleanupGearRecords(db,{now:200}),/private queue failure/);assert.equal(snapshot(),before);
  }finally{db.close();}
});

test('short retention prunes only exact-due private state and preserves active removal enforcement',async()=>{
  const db=openLocalDatabase();try{
    const now=40*GEAR_DAY_MS,id=await publish(db,0),draft=await createDraft(db,{...sample,email:'draft@example.test',title:'Draft'},now-3*GEAR_DAY_MS),fresh=await createDraft(db,{...sample,email:'fresh@example.test',title:'Fresh'},now-3*GEAR_DAY_MS+1);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);db.sqlite.prepare('INSERT INTO gear_removals VALUES(?,?,?,?)').run(id,'available',now-30*GEAR_DAY_MS,'Private old reason');
    db.sqlite.prepare('INSERT INTO gear_moderation_history(actor,action,listing_id,reason,before_status,after_status,created_at) VALUES(?,?,?,?,?,?,?)').run('owner@example.test','preserve-removal',id,'Old history','removed','removed',now-30*GEAR_DAY_MS);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,?)').run(crypto.randomUUID(),1,2,now-30*GEAR_DAY_MS);
    await cleanupGearRecords(db,{now});
    assert.equal(db.sqlite.prepare('SELECT 1 FROM gear_listings WHERE id=?').get(draft.id),undefined);assert.ok(db.sqlite.prepare('SELECT 1 FROM gear_listings WHERE id=?').get(fresh.id));
    assert.equal(count(db,'gear_moderation_history'),0);assert.equal(count(db,'gear_deletion_ledger'),0);assert.equal(db.sqlite.prepare('SELECT reason FROM gear_removals WHERE listing_id=?').get(id).reason,'Removal remains in effect; original reason expired.');
  }finally{db.close();}
});

test('maintenance drains bounded record and photo pages and reports an oversized backlog',async()=>{
  const db=openLocalDatabase();try{
    const now=10*GEAR_DAY_MS;
    for(let index=0;index<3;index++){const draft=await createDraft(db,{...sample,email:`draft${index}@example.test`,title:`Draft ${index}`},now-3*GEAR_DAY_MS);await recordHostedPhoto(db,draft.id,`00000000-0000-4000-8000-${String(index+2).padStart(12,'0')}`,now-1);}
    const deleted=[];const env={GEAR_DB:db,IMAGES:{hosted:{image:id=>({delete:async()=>{deleted.push(id);return true;}})}}};
    const result=await runGearMaintenance(env,{now,batchSize:1,maxRecordBatches:5,maxPhotoBatches:5});assert.equal(result.purgedDrafts,3);assert.equal(result.deletedPhotos,3);assert.equal(deleted.length,3);
    for(let index=0;index<2;index++)await createDraft(db,{...sample,email:`more${index}@example.test`,title:`More ${index}`},now-3*GEAR_DAY_MS);
    await assert.rejects(runGearMaintenance(env,{now,batchSize:1,maxRecordBatches:1,maxPhotoBatches:1}),error=>error instanceof GearMaintenanceError&&error.code==='record-backlog');
  }finally{db.close();}
});

test('shared operation budget stays below the invocation limit and drains photos before a record backlog',async()=>{
  const db=openLocalDatabase();try{
    const now=10*GEAR_DAY_MS;
    for(let index=0;index<50;index++)await createDraft(db,{...sample,email:`budget${index}@example.test`,title:`Budget ${index}`},now-3*GEAR_DAY_MS);
    for(let index=0;index<80;index++)db.sqlite.prepare('INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at) VALUES(?,?,?)').run(`00000000-0000-4000-8001-${String(index).padStart(12,'0')}`,crypto.randomUUID(),now-1);
    const deleted=[],budget=createGearMaintenanceBudget();
    const env={GEAR_DB:db,IMAGES:{hosted:{image:id=>({delete:async()=>{deleted.push(id);return true;}})}}};
    await assert.rejects(runGearMaintenance(env,{now,budget}),error=>error instanceof GearMaintenanceError&&error.code==='record-backlog');
    assert.equal(deleted.length,80);assert.equal(count(db,'gear_photo_deletions'),0);assert.equal(count(db,'gear_listings'),10);
    assert.ok(budget.remaining>=460);assert.ok(budget.remaining<900);
  }finally{db.close();}
});

test('record cleanup uses remaining budget to drain every newly staged photo',async()=>{
  const db=openLocalDatabase();try{
    const now=10*GEAR_DAY_MS,deleted=[];
    for(let listing=0;listing<30;listing++){
      const draft=await createDraft(db,{...sample,email:`burst${listing}@example.test`,title:`Burst ${listing}`},now-3*GEAR_DAY_MS);
      for(let photo=0;photo<6;photo++)await recordHostedPhoto(db,draft.id,`00000000-0000-4${String(listing).padStart(3,'0')}-8003-${String(photo).padStart(12,'0')}`,now-1);
    }
    const result=await runGearMaintenance({GEAR_DB:db,IMAGES:{hosted:{image:id=>({delete:async()=>{deleted.push(id);return true;}})}}},{now});
    assert.equal(result.purgedDrafts,30);assert.equal(result.deletedPhotos,180);assert.equal(deleted.length,180);assert.equal(count(db,'gear_photo_deletions'),0);
  }finally{db.close();}
});

test('slow Images failures preserve time for due record cleanup',async()=>{
  const db=openLocalDatabase();try{
    const now=10*GEAR_DAY_MS,draft=await createDraft(db,{...sample,email:'slow@example.test',title:'Slow images'},now-3*GEAR_DAY_MS);let clock=0;
    for(let index=0;index<80;index++)db.sqlite.prepare('INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at) VALUES(?,?,?)').run(`00000000-0000-4000-8004-${String(index).padStart(12,'0')}`,crypto.randomUUID(),now-1);
    const budget=createGearMaintenanceBudget({deadline:13*60*1000,clock:()=>clock}),images={hosted:{image:()=>({delete:async()=>{clock+=4000;throw new Error('slow provider');}})}};
    await assert.rejects(runGearMaintenance({GEAR_DB:db,IMAGES:images},{now,budget}),error=>error instanceof GearMaintenanceError&&error.code==='photo-delete');
    assert.equal(db.sqlite.prepare('SELECT 1 FROM gear_listings WHERE id=?').get(draft.id),undefined);assert.equal(clock,80*4000);
  }finally{db.close();}
});

test('empty image queue inside the time reserve does not create a false backlog',async()=>{
  const db=openLocalDatabase();try{
    const budget=createGearMaintenanceBudget({deadline:300000,clock:()=>1});
    const result=await runGearMaintenance({GEAR_DB:db,IMAGES:{hosted:{image(){throw new Error('must not run');}}}},{now:1,budget});
    assert.deepEqual(result,{purgedListings:0,purgedDrafts:0,prunedRows:0,deletedPhotos:0});
  }finally{db.close();}
});

test('fallback attempt update is charged after an outbox delete failure',async()=>{
  let calls=0;const budget=createGearMaintenanceBudget({maxDbOperations:3});
  const db={prepare(sql){return {bind(){return this;},async all(){calls++;return {results:[{providerId}]};},async run(){calls++;if(sql.startsWith('DELETE'))throw new Error('delete failed');return {meta:{changes:1}};}};}};
  const images={hosted:{image:()=>({delete:async()=>true})}};
  await assert.rejects(deleteQueuedPhotos(db,images,{now:200,batchSize:1,budget}),error=>error instanceof GearMaintenanceError&&error.code==='photo-delete');
  assert.equal(calls,3);assert.equal(budget.remaining,0);
});

test('expired maintenance deadline stops before a binding call',async()=>{
  let calls=0;const budget=createGearMaintenanceBudget({deadline:100,clock:()=>100});
  const env={GEAR_DB:{prepare(){calls++;throw new Error('must not run');},batch(){calls++;throw new Error('must not run');}},IMAGES:{hosted:{image(){calls++;throw new Error('must not run');}}}};
  await assert.rejects(runGearMaintenance(env,{now:100,budget}),error=>error instanceof GearMaintenanceError&&error.code==='photo-backlog');assert.equal(calls,0);
});

test('failed photo rows rotate behind untouched work',async()=>{
  const db=openLocalDatabase();try{
    const ids=[1,2,3].map(index=>`00000000-0000-4000-8002-${String(index).padStart(12,'0')}`);
    for(const id of ids)db.sqlite.prepare('INSERT INTO gear_photo_deletions(provider_id,listing_id,queued_at) VALUES(?,?,?)').run(id,crypto.randomUUID(),100);
    const attempted=[],images={hosted:{image:id=>({delete:async()=>{attempted.push(id);if(id===ids[0])throw new Error('provider failure');return true;}})}};
    await assert.rejects(deleteQueuedPhotos(db,images,{now:200,batchSize:2}),error=>error.code==='photo-delete');
    assert.deepEqual(attempted,ids.slice(0,2));attempted.length=0;
    assert.deepEqual(await deleteQueuedPhotos(db,images,{now:201,batchSize:1}),{deletedPhotos:1,failedPhotos:0,batchFull:true});assert.deepEqual(attempted,[ids[2]]);
  }finally{db.close();}
});

function fakeEnvironment(){
  const values=new Map();return {values,env:{
    GEAR_DB:{prepare(){},batch(){}},IMAGES:{hosted:{image(){}}},GEAR_RESEND_API_KEY:'test_key',GEAR_ALERT_RECIPIENT:'owner@example.test',
    GEAR_MAINTENANCE_STATE:{async get(key){return values.has(key)?JSON.parse(values.get(key)):null;},async put(key,value){values.set(key,value);},async delete(key){values.delete(key);}},
  }};
}

test('scheduled maintenance retries after one minute, sends one failure alert, then one recovery alert',async()=>{
  const {env,values}=fakeEnvironment(),delays=[],alerts=[];let calls=0;
  const run=async()=>{calls++;throw new GearMaintenanceError('database');},send=async input=>{alerts.push(input);return {id:responseId};};
  await assert.rejects(runScheduledGearMaintenance(env,{run,send,now:()=>200,delay:async ms=>delays.push(ms)}),/failed after retry/);
  assert.equal(calls,2);assert.deepEqual(delays,[GEAR_MAINTENANCE_RETRY_MS]);assert.equal(alerts.length,1);assert.equal(alerts[0].kind,'failure');assert.equal(values.size,1);
  await assert.rejects(runScheduledGearMaintenance(env,{run,send,now:()=>300,delay:async()=>{}}),/failed after retry/);assert.equal(alerts.length,1);
  const result=await runScheduledGearMaintenance(env,{run:async()=>({purgedListings:0}),send,now:()=>400});assert.equal(result.retried,false);assert.equal(alerts.length,2);assert.equal(alerts[1].kind,'recovery');assert.equal(alerts[1].episode,alerts[0].episode);assert.equal(values.size,0);
  values.set('gear-maintenance-status-v1',JSON.stringify({failing:true,alerted:false,episode:crypto.randomUUID(),failedAt:500}));
  await runScheduledGearMaintenance(env,{run:async()=>({purgedListings:0}),send,now:()=>501});assert.equal(alerts.length,2);assert.equal(values.size,0);
});

test('recovery alert failure does not rerun successful maintenance',async()=>{
  const {env,values}=fakeEnvironment();values.set('gear-maintenance-status-v1',JSON.stringify({failing:true,alerted:true,episode:crypto.randomUUID(),failedAt:100}));let runs=0,delays=0;
  await assert.rejects(runScheduledGearMaintenance(env,{run:async()=>{runs++;return {purgedListings:0};},send:async()=>{throw new GearMaintenanceAlertError('status:503');},now:()=>200,delay:async()=>{delays++;}}),/recovery alert failed/);
  assert.equal(runs,1);assert.equal(delays,0);assert.equal(values.size,1);
});

test('missing maintenance configuration fails before cleanup and scheduled handler registers its promise',async()=>{
  let runs=0;await assert.rejects(runScheduledGearMaintenance({}, {run:async()=>{runs++;}}),/bindings are not configured/);assert.equal(runs,0);
  const {env}=fakeEnvironment(),worker=createGearMaintenanceWorker({run:async()=>({purgedListings:0})});let pending;
  worker.scheduled({scheduledTime:1},env,{waitUntil(value){pending=value;}});assert.ok(pending instanceof Promise);await pending;
});

test('maintenance alerts use generic bounded Resend requests and non-sensitive failures',async()=>{
  const env={GEAR_RESEND_API_KEY:'test_key',GEAR_ALERT_RECIPIENT:'owner@example.test'},episode=crypto.randomUUID();let target,options;
  const result=await sendMaintenanceAlert({kind:'failure',episode,at:200},env,{fetcher:async(...args)=>{[target,options]=args;return new Response(JSON.stringify({id:responseId}),{status:200});}});
  assert.deepEqual(result,{id:responseId});assert.equal(target,'https://api.resend.com/emails');assert.equal(options.redirect,'manual');assert.equal(options.headers['Idempotency-Key'],`gear-maintenance-failure-${episode}`);
  const body=JSON.parse(options.body);assert.deepEqual(body.to,['owner@example.test']);assert.equal(JSON.stringify(body).includes(providerId),false);
  await assert.rejects(sendMaintenanceAlert({kind:'failure',episode,at:200},env,{fetcher:async()=>new Response('private',{status:429})}),error=>error instanceof GearMaintenanceAlertError&&error.code==='status:429'&&!error.message.includes('private'));
});
