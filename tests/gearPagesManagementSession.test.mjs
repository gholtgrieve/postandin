import test from 'node:test';
import assert from 'node:assert/strict';
import * as confirmRoute from '../functions/api/gear/management/confirm.js';
import * as logoutRoute from '../functions/api/gear/management/logout.js';
import * as recoveryRoute from '../functions/api/gear/management/recovery.js';
import * as sessionRoute from '../functions/api/gear/management/session.js';
import {createManagementConfirmHandler} from '../functions/api/gear/management/confirm.js';
import {createManagementLogoutHandler} from '../functions/api/gear/management/logout.js';
import {createManagementRecoveryHandler} from '../functions/api/gear/management/recovery.js';
import {createManagementSessionHandler} from '../functions/api/gear/management/session.js';
import {MANAGEMENT_TTL_MS,RECOVERY_COOLDOWN_MS,RECOVERY_DAILY_LIMIT,RECOVERY_WINDOW_MS,issueLocalManagementLink,issueManagementLink,recoverManagementSession,redeemManagementLink} from '../lib/gear-management.mjs';
import {GearManagementMailUnavailableError,sendManagementLink,validateManagementEmail} from '../lib/gear-management-mail.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification} from '../lib/gear-verification.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com';
const TOKEN='a'.repeat(64),SESSION='b'.repeat(64),CSRF='c'.repeat(64);
const sample={title:'Club bag',description:'Worn zipper.',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const responseId='01234567-89ab-4cde-8fab-0123456789ab';

function request(path,body={},headers={}){
  return new Request(ORIGIN+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
}
async function publish(db,now=100){const {id}=await createDraft(db,sample,now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
const context=(request,env={GEAR_DB:{}})=>({request,env});

test('production management issue preserves local simulation while returning only a delivery receipt',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);
    const production=await issueManagementLink(db,' SAMPLE@EXAMPLE.TEST ',200);
    assert.equal(production.recipient,sample.email);assert.match(production.token,/^[a-f0-9]{64}$/);assert.equal(production.delivery,undefined);
    assert.equal(await issueLocalManagementLink(db,sample.email,200+RECOVERY_COOLDOWN_MS-1),null);
    const local=await issueLocalManagementLink(db,sample.email,200+RECOVERY_COOLDOWN_MS);
    assert.equal(local.delivery,'local-simulation');assert.notEqual(local.token,production.token);
    assert.equal(await issueManagementLink(db,'unknown@example.test',200+RECOVERY_COOLDOWN_MS+1),null);
    const unicode={...sample,email:'müller@example.de',title:'Unicode seller'},draft=await createDraft(db,unicode,200+RECOVERY_COOLDOWN_MS+2),verification=await issueLocalVerification(db,draft.id,200+RECOVERY_COOLDOWN_MS+2);
    assert.equal((await confirmVerification(db,verification.token,200+RECOVERY_COOLDOWN_MS+2)).verified,true);assert.equal((await issueManagementLink(db,' MÜLLER@EXAMPLE.DE ',200+RECOVERY_COOLDOWN_MS+3)).recipient,unicode.email);
    assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_management_links').all()).includes(local.token),false);
  }finally{db.close();}
});

test('Resend adapter sends a bounded fragment link with authorization and token-derived idempotency',async()=>{
  let target,options;
  const result=await sendManagementLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'test_key'}, {fetcher:async(...args)=>{[target,options]=args;return new Response(JSON.stringify({id:responseId}),{status:200});}});
  assert.deepEqual(result,{id:responseId});assert.equal(target,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  assert.equal(options.headers.Authorization,'Bearer test_key');assert.match(options.headers['Idempotency-Key'],/^gear-management-[a-f0-9]{64}$/);assert.equal(options.headers['Idempotency-Key'].includes(TOKEN),false);
  const body=JSON.parse(options.body);assert.deepEqual(body.to,[sample.email]);assert.equal(body.from,'Post & In Gear <gear@postandin.com>');assert.equal(body.subject,'Your Post & In Gear Exchange management link');
  assert.ok(body.text.includes(`/gear/#management=${TOKEN}`));assert.equal(body.text.includes('?management='),false);assert.equal(JSON.stringify(options.headers).includes(TOKEN),false);
  for(const copy of ['Choose “Continue”','start a 30-day management session','signs out other devices currently managing those listings','edit listing details','add, remove, or reorder photos','mark gear pending or available','renew or relist eligible listings','remove a listing and recover it for 30 days','one-use and expires after 30 minutes'])assert.ok(body.text.includes(copy),copy);
  const durableOptions={};await sendManagementLink({recipient:sample.email,token:TOKEN,durable:true},{GEAR_RESEND_API_KEY:'test_key'},{fetcher:async(_target,value)=>{Object.assign(durableOptions,value);return new Response(JSON.stringify({id:responseId}),{status:200});}});
  const durable=JSON.parse(durableOptions.body);for(const copy of ['Save this email','Use this private link anytime','specific to this listing','Choose “Continue”','replaces any current Gear management session','signs out any other device using this link','session for this listing only','do not forward it','permanent deletion','verified email change','owner moderation','does not reissue it','temporary access link'])assert.ok(durable.text.includes(copy),copy);
});

test('mail validation and provider failures reveal no private provider detail',async()=>{
  assert.equal(validateManagementEmail(' SAMPLE@Example.test '),sample.email);
  assert.equal(validateManagementEmail(' MÜLLER@Example.de '),'müller@example.de');
  for(const value of [null,'','bad','a@b','a b@example.test','x'.repeat(255)+'@example.test'])assert.equal(validateManagementEmail(value),null);
  const cases=[
    [{},async()=>new Response(JSON.stringify({id:responseId})),'config'],
    [{GEAR_RESEND_API_KEY:'bad key'},async()=>new Response(JSON.stringify({id:responseId})),'config'],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('private upstream failure',{status:503}),'status:503'],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('{',{status:200}),'response'],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response(JSON.stringify({id:'bad'}),{status:200}),'response'],
    [{GEAR_RESEND_API_KEY:'key'},async()=>{throw new Error('private network failure');},'network'],
  ];
  for(const [env,fetcher,code] of cases)await assert.rejects(sendManagementLink({recipient:sample.email,token:TOKEN},env,{fetcher}),error=>error instanceof GearManagementMailUnavailableError&&error.message==='Gear management mail unavailable.'&&error.code===code);
  await assert.rejects(sendManagementLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'key'},{timeoutMs:1,fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>{if(signal.aborted)reject(new Error('private timeout'));else signal.addEventListener('abort',()=>reject(new Error('private timeout')),{once:true});})}),error=>error instanceof GearManagementMailUnavailableError&&error.code==='network');
});

test('recovery response is identical for known, unknown and failed delivery and never exposes credentials',async()=>{
  const calls=[],pending=[],logs=[];
  const handler=createManagementRecoveryHandler({issue:async(_db,email)=>email===sample.email?{recipient:email,token:TOKEN}:null,send:async receipt=>{calls.push(receipt);throw new GearManagementMailUnavailableError('status:503');},now:()=>200,log:(...values)=>logs.push(values)});
  const run=async email=>{const response=await handler({...context(request('/api/gear/management/recovery',{email})),waitUntil(value){pending.push(value);}});return {status:response.status,body:await response.text()};};
  const known=await run(sample.email),unknown=await run('unknown@example.test');await Promise.all(pending);
  assert.deepEqual(known,unknown);assert.equal(known.status,202);assert.equal(known.body.includes(TOKEN),false);assert.deepEqual(calls,[{recipient:sample.email,token:TOKEN}]);
  assert.deepEqual(logs,[['Gear management email delivery failed:','status:503']]);assert.equal(JSON.stringify(logs).includes(sample.email),false);assert.equal(JSON.stringify(logs).includes(TOKEN),false);
});

test('recovery cooldown preserves the live link, suppresses delivery and permits a new link after consumption',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);let now=200;const deliveries=[];
    const handler=createManagementRecoveryHandler({send:async receipt=>deliveries.push(receipt),now:()=>now});
    const run=async()=>{const pending=[];const response=await handler({...context(request('/api/gear/management/recovery',{email:sample.email}),{GEAR_DB:db,GEAR_RESEND_API_KEY:'unused'}),waitUntil(value){pending.push(value);}});await Promise.all(pending);return response;};
    const accepted=await run();assert.equal(accepted.status,202);assert.equal(deliveries.length,1);
    const expected={message:'If verified listings match that address, a management link will be sent.'};
    assert.deepEqual(await accepted.json(),expected);
    const first={...db.sqlite.prepare('SELECT token_hash,created_at FROM gear_management_links').get()};
    now=200+RECOVERY_COOLDOWN_MS-1;
    const blocked=await run();assert.equal(blocked.status,202);assert.deepEqual(await blocked.json(),expected);assert.equal(deliveries.length,1);
    assert.deepEqual({...db.sqlite.prepare('SELECT token_hash,created_at FROM gear_management_links').get()},first);
    assert.ok(await redeemManagementLink(db,deliveries[0].token,now));
    assert.ok(now-200<RECOVERY_COOLDOWN_MS);
    assert.equal((await run()).status,202);assert.equal(deliveries.length,2);
    assert.notEqual(deliveries[1].token,deliveries[0].token);
  }finally{db.close();}
});

test('concurrent recovery requests create only one deliverable link',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);
    const receipts=await Promise.all([issueManagementLink(db,sample.email,200),issueManagementLink(db,sample.email,200)]);
    assert.equal(receipts.filter(Boolean).length,1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_links').get().n,1);
  }finally{db.close();}
});

test('recovery delivery is capped per seller for 24 hours and resets at the boundary',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);const start=200;
    for(let index=0;index<RECOVERY_DAILY_LIMIT;index++)assert.ok(await issueManagementLink(db,sample.email,start+index*RECOVERY_COOLDOWN_MS));
    assert.equal(await issueManagementLink(db,sample.email,start+RECOVERY_DAILY_LIMIT*RECOVERY_COOLDOWN_MS),null);
    assert.equal(await issueManagementLink(db,sample.email,start+RECOVERY_WINDOW_MS-1),null);
    const limited=db.sqlite.prepare('SELECT issue_count,window_started_at FROM gear_management_links').get();
    assert.deepEqual({...limited},{issue_count:RECOVERY_DAILY_LIMIT,window_started_at:start});
    assert.ok(await issueManagementLink(db,sample.email,start+RECOVERY_WINDOW_MS));
    assert.deepEqual({...db.sqlite.prepare('SELECT issue_count,window_started_at FROM gear_management_links').get()},{issue_count:1,window_started_at:start+RECOVERY_WINDOW_MS});
  }finally{db.close();}
});

test('failed recovery delivery still applies the per-seller cooldown',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);let now=200,sends=0;
    const handler=createManagementRecoveryHandler({now:()=>now,send:async()=>{sends++;throw new GearManagementMailUnavailableError('status:503');},log:()=>{}});
    const run=async()=>{const pending=[];const response=await handler({...context(request('/api/gear/management/recovery',{email:sample.email}),{GEAR_DB:db,GEAR_RESEND_API_KEY:'unused'}),waitUntil(value){pending.push(value);}});await Promise.all(pending);return response;};
    assert.equal((await run()).status,202);assert.equal(sends,1);
    now++;
    assert.equal((await run()).status,202);assert.equal(sends,1);
  }finally{db.close();}
});

test('production routes complete confirmation, stable reload recovery, logout and replay protection',async()=>{
  const db=openLocalDatabase();try{
    await publish(db);let receipt;const pending=[];
    const recovery=createManagementRecoveryHandler({send:async value=>{receipt=value;},now:()=>200});
    let response=await recovery({...context(request('/api/gear/management/recovery',{email:sample.email}),{GEAR_DB:db,GEAR_RESEND_API_KEY:'unused'}),waitUntil(value){pending.push(value);}});
    assert.equal(response.status,202);await Promise.all(pending);assert.ok(receipt);
    const confirm=createManagementConfirmHandler({now:()=>201});
    assert.equal((await confirm(context(request('/api/gear/management/confirm',{token:receipt.token})))).status,400);
    response=await confirm(context(request('/api/gear/management/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:db}));assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie');assert.equal(cookie,`__Host-gear_session=${cookie.split('=')[1].split(';')[0]}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MANAGEMENT_TTL_MS/1000}`);
    const raw=cookie.match(/^__Host-gear_session=([a-f0-9]{64});/)[1],access=await response.json();assert.deepEqual(Object.keys(access).sort(),['csrf','expiresAt']);assert.equal(access.expiresAt,201+MANAGEMENT_TTL_MS);
    assert.equal((await confirm(context(request('/api/gear/management/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:db}))).status,400);
    const session=createManagementSessionHandler({now:()=>202});
    response=await session(context(request('/api/gear/management/session',{}, {Cookie:`__Host-gear_session=${raw}`}),{GEAR_DB:db}));assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.deepEqual(await response.json(),access);
    const logout=createManagementLogoutHandler({now:()=>203});
    response=await logout(context(request('/api/gear/management/logout',{}, {Cookie:`__Host-gear_session=${raw}`,'X-Gear-CSRF':access.csrf}),{GEAR_DB:db}));assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),'__Host-gear_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    assert.equal(await recoverManagementSession(db,raw,204),null);
    assert.equal((await session(context(request('/api/gear/management/session',{}, {Cookie:`__Host-gear_session=${raw}`}),{GEAR_DB:db}))).status,401);
  }finally{db.close();}
});

test('request boundary rejects wrong origin, content type, malformed and oversized bodies before adapters',async()=>{
  let calls=0;const handlers=[
    createManagementRecoveryHandler({issue:async()=>{calls++;return null;}}),
    createManagementConfirmHandler({redeem:async()=>{calls++;return null;}}),
    createManagementSessionHandler({recover:async()=>{calls++;return null;}}),
    createManagementLogoutHandler({revoke:async()=>{calls++;return false;}}),
  ];
  const paths=['recovery','confirm','session','logout'];
  for(let index=0;index<handlers.length;index++){
    const handler=handlers[index],path=`/api/gear/management/${paths[index]}`,auth={Cookie:`__Host-gear_session=${SESSION}`,'X-Gear-CSRF':CSRF};
    assert.equal((await handler(context(request(path,{}, {...auth,Origin:'https://example.test'})))).status,403);
    assert.equal((await handler(context(request(path,{}, {...auth,'Sec-Fetch-Site':'cross-site'})))).status,403);
    assert.equal((await handler(context(request(path,{}, {...auth,'Content-Type':'text/plain'})))).status,415);
    assert.equal((await handler(context(request(path,'{',{...auth})))).status,400);
    assert.equal((await handler(context(request(path,{value:'x'.repeat(1100)},{...auth})))).status,413);
  }
  assert.equal(calls,0);
});

test('session and logout reject missing, duplicate and lookalike cookies plus missing CSRF',async()=>{
  let recovers=0,revokes=0;const session=createManagementSessionHandler({recover:async()=>{recovers++;return {csrf:CSRF,expiresAt:2};}}),logout=createManagementLogoutHandler({revoke:async()=>{revokes++;return true;}});
  for(const Cookie of ['',`__Host-gear_session=${SESSION}; __Host-gear_session=${SESSION}`,`__Host-gear_session_extra=${SESSION}`]){
    assert.equal((await session(context(request('/api/gear/management/session',{}, {Cookie})))).status,401);
    assert.equal((await logout(context(request('/api/gear/management/logout',{}, {Cookie,'X-Gear-CSRF':CSRF})))).status,401);
  }
  assert.equal((await logout(context(request('/api/gear/management/logout',{}, {Cookie:`__Host-gear_session=${SESSION}`})))).status,403);
  const stale=await createManagementLogoutHandler({revoke:async()=>false})(context(request('/api/gear/management/logout',{}, {Cookie:`__Host-gear_session=${SESSION}`,'X-Gear-CSRF':CSRF})));
  assert.equal(stale.status,401);assert.equal(stale.headers.get('set-cookie'),'__Host-gear_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  assert.equal(recovers,0);assert.equal(revokes,0);
});

test('missing bindings and private adapter exceptions produce generic responses',async()=>{
  const routeCases=[
    [createManagementRecoveryHandler(),request('/api/gear/management/recovery',{email:sample.email})],
    [createManagementConfirmHandler(),request('/api/gear/management/confirm',{token:TOKEN,confirm:true})],
    [createManagementSessionHandler(),request('/api/gear/management/session',{}, {Cookie:`__Host-gear_session=${SESSION}`})],
    [createManagementLogoutHandler(),request('/api/gear/management/logout',{}, {Cookie:`__Host-gear_session=${SESSION}`,'X-Gear-CSRF':CSRF})],
  ];
  for(const [handler,value] of routeCases){const response=await handler(context(value,{}));assert.equal(response.status,503);assert.equal((await response.text()).includes('GEAR_DB'),false);}
  const throwing=[
    [createManagementRecoveryHandler({issue:async()=>{throw new Error('private issue detail');}}),request('/api/gear/management/recovery',{email:sample.email})],
    [createManagementConfirmHandler({redeem:async()=>{throw new Error('private redeem detail');}}),request('/api/gear/management/confirm',{token:TOKEN,confirm:true})],
    [createManagementSessionHandler({recover:async()=>{throw new Error('private recover detail');}}),request('/api/gear/management/session',{}, {Cookie:`__Host-gear_session=${SESSION}`})],
    [createManagementLogoutHandler({revoke:async()=>{throw new Error('private revoke detail');}}),request('/api/gear/management/logout',{}, {Cookie:`__Host-gear_session=${SESSION}`,'X-Gear-CSRF':CSRF})],
  ];
  for(const [handler,value] of throwing){const response=await handler(context(value));assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);}
});

test('Pages exposes only POST handlers so scanners cannot redeem or mutate with GET',()=>{
  for(const route of [recoveryRoute,confirmRoute,sessionRoute,logoutRoute])assert.deepEqual(Object.keys(route).filter(key=>key.startsWith('onRequest')),['onRequestPost']);
});
