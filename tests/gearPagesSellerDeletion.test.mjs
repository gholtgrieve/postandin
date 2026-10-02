import test from 'node:test';
import assert from 'node:assert/strict';
import {createSellerDeletionHandler,onRequestPost} from '../functions/api/gear/management/deletion.js';
import {changeSellerDeletion,SELLER_RECOVERY_MS,validateSellerDeletionAction} from '../lib/gear-seller-deletion.mjs';
import {moderateListing} from '../lib/gear-moderation-actions.mjs';
import {submitReport} from '../lib/gear-report-storage.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {issueLocalManagementLink,redeemManagementLink,revokeManagement} from '../lib/gear-management.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com';
const sample={title:'Club bag',description:'Worn zipper, repaired seam.',city:'Seattle',fit:'Junior bag',sellerName:'Sample seller',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4050,clubs:['Kent Valley']};
async function publish(db,patch={},now=100){const {id}=await createDraft(db,{...sample,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
async function login(db,email=sample.email,now=150){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
const action=(action,id)=>({action,id});
const snapshot=db=>JSON.stringify(['gear_listings','gear_deletions','gear_deletion_ledger','gear_reports','gear_removals','gear_moderation_history'].map(table=>db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));

test('authenticated seller deletion hides a listing and recovery restores it without changing report evidence',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),reportId=crypto.randomUUID();
    assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},190,reportId),true);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200),{ok:true});
    assert.deepEqual({...db.sqlite.prepare('SELECT previous_status,deleted_at,purge_at FROM gear_deletions').get()},{previous_status:'available',deleted_at:200,purge_at:200+SELLER_RECOVERY_MS});
    assert.deepEqual({...db.sqlite.prepare('SELECT deleted_at,purge_at,purged_at FROM gear_deletion_ledger').get()},{deleted_at:200,purge_at:200+SELLER_RECOVERY_MS,purged_at:null});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    assert.deepEqual(await readPublicListings(db,201),[]);
    assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},201,crypto.randomUUID()),false);
    assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'remove',id:reportId,reason:'Cannot remove twice'},202),false);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),203),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_deletions').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_deletion_ledger').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'open');
    assert.equal((await readPublicListings(db,204)).length,1);
  }finally{db.close();}
});

test('seller recovery preserves owner moderation and only clears the seller deletion state',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),reportId=crypto.randomUUID();
    await submitReport(db,{listingId:id,reason:'Prohibited item'},190,reportId);
    assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'remove',id:reportId,reason:'Owner removal'},200),true);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),201),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT previous_status FROM gear_deletions').get().previous_status,'removed');
    const foreignId=await publish(db,{email:'other@example.test',title:'Other seller'},201),foreign=await login(db,'other@example.test',202),before=snapshot(db);
    assert.ok(foreignId);
    assert.deepEqual(await changeSellerDeletion(db,foreign.session,foreign.csrf,action('recover',id),203),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),before);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),204),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_removals').get().n,1);
    assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'restore',id,reason:'Separate owner review'},205),true);
  }finally{db.close();}
});

test('seller deletion rejects foreign, repeated and overdue actions without extending or partially writing',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),otherId=await publish(db,{email:'other@example.test',title:'Other bag'},110),other=await login(db,'other@example.test',150);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',otherId),200),{ok:false,reason:'conflict'});
    assert.deepEqual(await changeSellerDeletion(db,'bad',access.csrf,action('delete',id),200),{ok:false,reason:'access'});
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200),{ok:true});
    const afterDelete=snapshot(db);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),201),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),afterDelete);
    const deadline=200+SELLER_RECOVERY_MS;
    db.sqlite.prepare('UPDATE gear_management_sessions SET expires_at=?').run(deadline+1);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),deadline),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),afterDelete);
    assert.deepEqual(await changeSellerDeletion(db,other.session,other.csrf,action('recover',id),202),{ok:false,reason:'conflict'});
  }finally{db.close();}
});

test('seller recovery rechecks duplicates and expires stale matches only on success',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);
    await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200);
    const duplicate=await publish(db,{title:sample.title},201);
    const blocked=snapshot(db);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),202),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),blocked);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(203,duplicate);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),204),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(duplicate).status,'expired');
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');
  }finally{db.close();}
});

test('seller recovery rechecks verification and active quota but restores elapsed listings as expired',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),verified=db.sqlite.prepare('SELECT verified_at FROM gear_sellers').get().verified_at;
    await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200);
    const stale=await publish(db,{title:sample.title},201);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=202 WHERE id=?').run(stale);
    await publish(db,{email:'other@example.test',title:'Other seller'},201);
    db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL WHERE email=?').run(sample.email);
    const unverified=snapshot(db);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),203),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),unverified);
    db.sqlite.prepare('UPDATE gear_sellers SET verified_at=? WHERE email=?').run(verified,sample.email);
    for(let index=0;index<10;index++)await publish(db,{title:`Quota ${index}`},204+index);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),220),{ok:false,reason:'conflict'});
    db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE title='Quota 0'").run();
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),221),{ok:true});
    db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE title='Quota 1'").run();
    const elapsed=await publish(db,{title:'Elapsed'},222);
    await changeSellerDeletion(db,access.session,access.csrf,action('delete',elapsed),223);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=224 WHERE id=?').run(elapsed);
    db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL WHERE email=?').run(sample.email);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',elapsed),224),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(elapsed).status,'expired');
  }finally{db.close();}
});

test('seller deletion enforces CSRF and every session lifetime state at the database boundary',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),first=await login(db),unchanged=()=>snapshot(db);
    let before=unchanged();
    assert.deepEqual(await changeSellerDeletion(db,first.session,'0'.repeat(64),action('delete',id),200),{ok:false,reason:'access'});assert.equal(unchanged(),before);
    const second=await login(db,sample.email,201);before=unchanged();
    assert.deepEqual(await changeSellerDeletion(db,first.session,first.csrf,action('delete',id),202),{ok:false,reason:'access'});assert.equal(unchanged(),before);
    assert.equal(await revokeManagement(db,second.session,second.csrf,203),true);before=unchanged();
    assert.deepEqual(await changeSellerDeletion(db,second.session,second.csrf,action('delete',id),204),{ok:false,reason:'access'});assert.equal(unchanged(),before);
    const third=await login(db,sample.email,205),stored=db.sqlite.prepare('SELECT created_at,expires_at FROM gear_management_sessions WHERE revoked_at IS NULL').get();before=unchanged();
    assert.deepEqual(await changeSellerDeletion(db,third.session,third.csrf,action('delete',id),stored.expires_at),{ok:false,reason:'access'});assert.equal(unchanged(),before);
    db.sqlite.prepare('UPDATE gear_management_sessions SET created_at=?,expires_at=? WHERE revoked_at IS NULL').run(300,400);before=unchanged();
    assert.deepEqual(await changeSellerDeletion(db,third.session,third.csrf,action('delete',id),299),{ok:false,reason:'access'});assert.equal(unchanged(),before);
    db.sqlite.prepare('UPDATE gear_management_sessions SET created_at=200,expires_at=400 WHERE revoked_at IS NULL').run();
    const raced={prepare:(...args)=>db.prepare(...args),batch:async statements=>{db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=250 WHERE revoked_at IS NULL').run();return db.batch(statements);}};before=unchanged();
    assert.deepEqual(await changeSellerDeletion(raced,third.session,third.csrf,action('delete',id),249),{ok:false,reason:'conflict'});assert.equal(unchanged(),before);
  }finally{db.close();}
});

test('recovery rechecks session liveness inside the batch for active and owner-moderated deletions',async()=>{
  for(const moderated of [false,true]){
    const db=openLocalDatabase();
    try{
      const id=await publish(db),access=await login(db);
      if(moderated){const reportId=crypto.randomUUID();await submitReport(db,{listingId:id,reason:'Other concern'},190,reportId);await moderateListing(db,{actor:'owner@example.test',action:'remove',id:reportId,reason:'Owner removal'},191);}
      await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200);
      const raced={prepare:(...args)=>db.prepare(...args),batch:async statements=>{db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=201 WHERE revoked_at IS NULL').run();return db.batch(statements);}};
      const before=snapshot(db);
      assert.deepEqual(await changeSellerDeletion(raced,access.session,access.csrf,action('recover',id),201),{ok:false,reason:'conflict'});
      assert.equal(snapshot(db),before);
    }finally{db.close();}
  }
});

test('failed recovery preserves an unpurged ledger that has no active marker',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,200,200+SELLER_RECOVERY_MS);
    const before=snapshot(db);
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('recover',id),201),{ok:false,reason:'conflict'});
    assert.equal(snapshot(db),before);
  }finally{db.close();}
});

test('seller deletion database failures roll back the marker, ledger and listing status',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),before=snapshot(db);
    db.sqlite.exec("CREATE TRIGGER fail_seller_deletion BEFORE INSERT ON gear_deletion_ledger BEGIN SELECT RAISE(ABORT,'private test failure'); END");
    await assert.rejects(changeSellerDeletion(db,access.session,access.csrf,action('delete',id),200),/private test failure/);
    assert.equal(snapshot(db),before);
    db.sqlite.exec('DROP TRIGGER fail_seller_deletion');
    assert.deepEqual(await changeSellerDeletion(db,access.session,access.csrf,action('delete',id),201),{ok:true});
    db.sqlite.exec("CREATE TRIGGER fail_seller_recovery BEFORE DELETE ON gear_deletion_ledger BEGIN SELECT RAISE(ABORT,'private recovery failure'); END");
    const deleted=snapshot(db);
    await assert.rejects(changeSellerDeletion(db,access.session,access.csrf,action('recover',id),202),/private recovery failure/);
    assert.equal(snapshot(db),deleted);
  }finally{db.close();}
});

function request(body=action('delete','00000000-0000-4000-8000-000000000001'),options={}){
  const headers={Origin:ORIGIN,'Content-Type':'application/json',Cookie:'__Host-gear_session='+'a'.repeat(64),'X-Gear-CSRF':'b'.repeat(64),...options.headers};
  return new Request(options.url??ORIGIN+'/api/gear/management/deletion',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
}

test('seller deletion route enforces request, cookie, CSRF and body boundaries before D1',async()=>{
  let changes=0;const handler=createSellerDeletionHandler({change:async()=>{changes++;return {ok:true};}}),id=crypto.randomUUID();
  const cases=[
    request(action('delete',id),{url:'https://preview.pages.dev/api/gear/management/deletion'}),
    request(action('delete',id),{headers:{Origin:'https://example.test'}}),
    request(action('delete',id),{headers:{'Sec-Fetch-Site':'cross-site'}}),
    request(action('delete',id),{headers:{'Content-Type':'text/plain'}}),
  ];
  for(const value of cases)assert.ok([403,415].includes((await handler({request:value,env:{GEAR_DB:{}}})).status));
  assert.equal((await handler({request:request(action('delete',id),{headers:{Cookie:''}}),env:{GEAR_DB:{}}})).status,401);
  assert.equal((await handler({request:request(action('delete',id),{headers:{Cookie:`__Host-gear_session=${'a'.repeat(64)}; __Host-gear_session=${'a'.repeat(64)}`}}),env:{GEAR_DB:{}}})).status,401);
  assert.equal((await handler({request:request(action('delete',id),{headers:{Cookie:`__Host-gear_session_extra=${'a'.repeat(64)}`}}),env:{GEAR_DB:{}}})).status,401);
  assert.equal((await handler({request:request(action('delete',id),{headers:{'X-Gear-CSRF':''}}),env:{GEAR_DB:{}}})).status,403);
  assert.equal((await handler({request:request('{'),env:{GEAR_DB:{}}})).status,400);
  assert.equal((await handler({request:request({...action('delete',id),extra:'x'.repeat(1100)}),env:{GEAR_DB:{}}})).status,413);
  assert.equal((await handler({request:request({action:'purge',id}),env:{GEAR_DB:{}}})).status,400);
  assert.equal(changes,0);
});

test('seller deletion route passes only authenticated transport fields and keeps failures generic',async()=>{
  const id=crypto.randomUUID(),session='a'.repeat(64),csrf='b'.repeat(64),db={marker:'db'};let received;
  const success=createSellerDeletionHandler({change:async(...args)=>{received=args;return {ok:true};},now:()=>200});
  let response=await success({request:request({action:'delete',id,sellerId:'attacker'}),env:{GEAR_DB:db}});
  assert.equal(response.status,200);assert.deepEqual(received,[db,session,csrf,{action:'delete',id},200]);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  response=await createSellerDeletionHandler({change:async()=>({ok:false,reason:'access'})})({request:request(action('delete',id)),env:{GEAR_DB:{}}});assert.equal(response.status,401);
  response=await createSellerDeletionHandler({change:async()=>({ok:false,reason:'conflict'})})({request:request(action('delete',id)),env:{GEAR_DB:{}}});assert.equal(response.status,409);
  response=await createSellerDeletionHandler({change:async()=>{throw new Error('private database detail');}})({request:request(action('delete',id)),env:{GEAR_DB:{}}});assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
  response=await createSellerDeletionHandler()({request:request(action('delete',id)),env:{}});assert.equal(response.status,503);
  let prepared=0;response=await onRequestPost({request:request(action('delete',id),{headers:{Cookie:''}}),env:{GEAR_DB:{prepare(){prepared++;}}}});assert.equal(response.status,401);assert.equal(prepared,0);
});

test('seller deletion validation accepts only bounded actions and UUIDs',()=>{
  const id=crypto.randomUUID();
  assert.deepEqual(validateSellerDeletionAction({action:'delete',id,owner:'ignored'}),{action:'delete',id});
  assert.deepEqual(validateSellerDeletionAction({action:'recover',id}),{action:'recover',id});
  for(const value of [null,[],{},action('purge',id),action('delete','bad')])assert.equal(validateSellerDeletionAction(value),null);
});
