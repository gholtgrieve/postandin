import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {moderateListing,validateModerationAction} from '../lib/gear-moderation-actions.mjs';
import {GearAccessDeniedError,GearAccessUnavailableError} from '../lib/gear-access.mjs';
import {createOwnerActionHandler,onRequestPost} from '../functions/api/gear/admin/actions.js';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const OWNER='owner@example.test';
const sample={title:'Club bag',description:'Worn zipper, repaired seam.',city:'Seattle',fit:'Junior bag',sellerName:'Sample seller',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4050,clubs:['Kent Valley']};
async function publish(db,patch={},now=100){const {id}=await createDraft(db,{...sample,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
function report(db,id,reason='Other concern',now=150){const reportId=crypto.randomUUID();db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) SELECT ?,id,title,?,? FROM gear_listings WHERE id=?').run(reportId,reason,now,id);return reportId;}
const action=(action,id,reason='Owner reviewed')=>({actor:OWNER,action,id,reason});

test('production moderation dismisses once and writes bounded owner history atomically',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),reportId=report(db,id,'Misleading listing');
    assert.equal(await moderateListing(db,action('dismiss',reportId),200),true);
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'dismissed');
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');
    assert.deepEqual({...db.sqlite.prepare('SELECT actor,action,listing_id,report_id,report_reason,reason,before_status,after_status,created_at FROM gear_moderation_history').get()},
      {actor:OWNER,action:'dismiss',listing_id:id,report_id:reportId,report_reason:'Misleading listing',reason:'Owner reviewed',before_status:'available',after_status:'available',created_at:200});
    assert.equal(await moderateListing(db,action('dismiss',reportId),201),false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_moderation_history').get().n,1);
  }finally{db.close();}
});

test('production moderation removes and restores without changing expiry or report evidence',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),expiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at;
    db.sqlite.prepare("UPDATE gear_listings SET status='pending' WHERE id=?").run(id);
    const reportId=report(db,id,'Prohibited item');
    assert.equal(await moderateListing(db,action('remove',reportId,'Policy violation'),200),true);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    assert.deepEqual({...db.sqlite.prepare('SELECT previous_status,removed_at,reason FROM gear_removals WHERE listing_id=?').get(id)},{previous_status:'pending',removed_at:200,reason:'Policy violation'});
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'removed');
    assert.equal(await moderateListing(db,action('remove',reportId,'Policy violation'),201),false);
    const staleDuplicate=await publish(db,{title:sample.title},202);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(203,staleDuplicate);
    db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'removed',202,203);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,202,203);
    assert.equal(await moderateListing(db,action('restore',id,'Blocked by overdue seller deletion'),204),false);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(staleDuplicate).status,'available');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_removals').get().n,1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_moderation_history').get().n,1);
    db.sqlite.prepare('DELETE FROM gear_deletions WHERE listing_id=?').run(id);
    assert.equal(await moderateListing(db,action('restore',id,'Reviewed and eligible'),205),true);
    assert.deepEqual({...db.sqlite.prepare('SELECT status,expires_at FROM gear_listings WHERE id=?').get(id)},{status:'pending',expires_at:expiry});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(staleDuplicate).status,'expired');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_deletion_ledger WHERE listing_id=?').get(id).n,1);
    assert.equal(db.sqlite.prepare('SELECT * FROM gear_removals WHERE listing_id=?').get(id),undefined);
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'removed');
    assert.deepEqual(db.sqlite.prepare('SELECT action FROM gear_moderation_history ORDER BY id').all().map(row=>row.action),['remove','restore']);
    assert.equal(await moderateListing(db,action('restore',id,'Reviewed and eligible'),206),false);
  }finally{db.close();}
});

test('production restore rechecks expiry, verification, duplicates and quota without partial writes',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),reportId=report(db,id);assert.equal(await moderateListing(db,action('remove',reportId),200),true);
    const expiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at;
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(300,id);
    assert.equal(await moderateListing(db,action('restore',id),300),false);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(expiry,id);
    const sellerVerified=db.sqlite.prepare('SELECT verified_at FROM gear_sellers').get().verified_at;db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL').run();
    assert.equal(await moderateListing(db,action('restore',id),301),false);db.sqlite.prepare('UPDATE gear_sellers SET verified_at=?').run(sellerVerified);
    const duplicate=await publish(db,{title:sample.title},302);
    assert.equal(await moderateListing(db,action('restore',id),303),false);
    db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(duplicate);
    for(let index=0;index<10;index++)await publish(db,{title:`Other ${index}`},304+index);
    assert.equal(await moderateListing(db,action('restore',id),400),false);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_moderation_history').get().n,1);
    db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE title='Other 0'").run();
    assert.equal(await moderateListing(db,action('restore',id),401),true);
  }finally{db.close();}
});

test('production moderation rolls back listing, report and stale cleanup when audit persistence fails',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),reportId=report(db,id);
    db.sqlite.exec("CREATE TRIGGER fail_moderation_audit BEFORE INSERT ON gear_moderation_history BEGIN SELECT RAISE(ABORT,'private audit failure'); END;");
    await assert.rejects(moderateListing(db,action('remove',reportId),200),/private audit failure/);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'open');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_removals').get().n,0);
    db.sqlite.exec('DROP TRIGGER fail_moderation_audit');assert.equal(await moderateListing(db,action('remove',reportId),201),true);
    const stale=await publish(db,{title:sample.title},202);db.sqlite.prepare('UPDATE gear_listings SET expires_at=203 WHERE id=?').run(stale);
    db.sqlite.exec("CREATE TRIGGER fail_restore_audit BEFORE INSERT ON gear_moderation_history BEGIN SELECT RAISE(ABORT,'private restore failure'); END;");
    await assert.rejects(moderateListing(db,action('restore',id),204),/private restore failure/);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'available');
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    db.sqlite.exec('DROP TRIGGER fail_restore_audit');assert.equal(await moderateListing(db,action('restore',id),205),true);
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'expired');
  }finally{db.close();}
});

const bodyId='00000000-0000-4000-8000-000000000001';
const request=(body=action('dismiss',bodyId),options={})=>new Request(options.url??'https://gear-admin.postandin.com/api/gear/admin/actions',{method:'POST',headers:{Origin:'https://gear-admin.postandin.com','Content-Type':'application/json',...options.headers},body:typeof body==='string'?body:JSON.stringify(body)});

test('owner action route enforces same-origin bounded JSON and Access before moderation',async()=>{
  let verifies=0,moderates=0;
  const handler=createOwnerActionHandler({verify:async()=>{verifies++;return {email:OWNER};},moderate:async()=>{moderates++;return true;}});
  const cases=[
    request(undefined,{url:'https://postandin.com/api/gear/admin/actions'}),
    request(undefined,{headers:{Origin:'https://example.test'}}),
    new Request('https://gear-admin.postandin.com/api/gear/admin/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),
    request(undefined,{headers:{'Sec-Fetch-Site':'cross-site'}}),
    request(undefined,{headers:{'Content-Type':'text/plain'}}),
  ];
  for(const value of cases)assert.ok([403,415].includes((await handler({request:value,env:{GEAR_DB:{}}})).status));
  assert.equal(verifies,0);assert.equal(moderates,0);
  assert.equal((await handler({request:request('{'),env:{GEAR_DB:{}}})).status,400);
  assert.equal((await handler({request:new Request('https://gear-admin.postandin.com/api/gear/admin/actions',{method:'POST',headers:{Origin:'https://gear-admin.postandin.com','Content-Type':'application/json'},body:new Uint8Array([0xff])}),env:{GEAR_DB:{}}})).status,400);
  assert.equal((await handler({request:request(action('dismiss',bodyId),{headers:{'Content-Length':'4097'}}),env:{GEAR_DB:{}}})).status,413);
  assert.equal((await handler({request:request({...action('dismiss',bodyId),extra:'x'.repeat(5000)}),env:{GEAR_DB:{}}})).status,413);
  assert.equal((await handler({request:request({}),env:{GEAR_DB:{}}})).status,400);
  assert.equal(moderates,0);
  const denied=createOwnerActionHandler({verify:async()=>{throw new GearAccessDeniedError();},moderate:async()=>{moderates++;}});
  assert.equal((await denied({request:request(),env:{GEAR_DB:{}}})).status,403);assert.equal(moderates,0);
});

test('owner action route uses verified actor and keeps conflicts and failures generic',async()=>{
  const logged=console.error,errors=[];console.error=(...args)=>errors.push(args);
  try{
    let received;
    const success=createOwnerActionHandler({verify:async()=>({email:OWNER}),moderate:async(db,input,now)=>{received={db,input,now};return true;},now:()=>200});
    const spoofed={...action('dismiss',bodyId),actor:'attacker@example.test',status:'removed'};
    const db={marker:'db'},response=await success({request:request(spoofed),env:{GEAR_DB:db}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(received,{db,input:action('dismiss',bodyId),now:200});
    let conflict=await createOwnerActionHandler({verify:async()=>({email:OWNER}),moderate:async()=>false})({request:request(),env:{GEAR_DB:{}}});
    assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{error:'The listing or report changed. Refresh and review it.'});
    const unavailable=createOwnerActionHandler({verify:async()=>{throw new GearAccessUnavailableError('private key detail');}});
    assert.equal((await unavailable({request:request(),env:{GEAR_DB:{}}})).status,503);
    const failed=createOwnerActionHandler({verify:async()=>({email:OWNER}),moderate:async()=>{throw new Error('private database detail');}});
    const failure=await failed({request:request(),env:{GEAR_DB:{}}});assert.equal(failure.status,500);assert.equal((await failure.text()).includes('private'),false);
    assert.equal(errors.some(entry=>String(entry.at(-1)).includes('private database detail')),true);
    let prepares=0;
    const real=await onRequestPost({request:request(),env:{GEAR_DB:{prepare(){prepares++;throw new Error('must not write');}}}});
    assert.equal(real.status,503);assert.equal(prepares,0);
  }finally{console.error=logged;}
});

test('moderation action validation rejects malformed identifiers, reasons and actions',()=>{
  assert.deepEqual(validateModerationAction({action:'remove',id:bodyId,reason:'  Reviewed  ',extra:'discarded'}),{action:'remove',id:bodyId,reason:'Reviewed'});
  for(const input of [null,[],{},action('purge',bodyId),action('remove','bad'),action('remove',bodyId,' '),action('remove',bodyId,'x'.repeat(501)),action('remove',bodyId,'line\nbreak')])assert.equal(validateModerationAction(input),null);
});
