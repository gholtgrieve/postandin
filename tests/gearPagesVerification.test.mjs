import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {createDraftSubmissionHandler} from '../functions/api/gear/drafts.js';
import {createVerificationRequestHandler} from '../functions/api/gear/verification/request.js';
import {createVerificationConfirmHandler} from '../functions/api/gear/verification/confirm.js';
import * as draftRoute from '../functions/api/gear/drafts.js';
import * as requestRoute from '../functions/api/gear/verification/request.js';
import * as confirmRoute from '../functions/api/gear/verification/confirm.js';
import {createTurnstileVerifier,GearTurnstileRejectedError,GearTurnstileUnavailableError} from '../lib/gear-turnstile.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification,issueVerification,releaseFailedVerificationIssue,TOKEN_TTL_MS,VERIFICATION_MAX_ISSUES,VERIFICATION_REISSUE_COOLDOWN_MS} from '../lib/gear-verification.mjs';
import {GEAR_DRAFT_RETENTION_MS} from '../lib/gear-exchange.mjs';
import {GearVerificationMailUnavailableError,sendVerificationLink} from '../lib/gear-verification-mail.mjs';

const ORIGIN='https://postandin.com';
const TOKEN='a'.repeat(64),RESPONSE_ID='01234567-89ab-4cde-8fab-0123456789ab';
const sample={title:'Club bag',description:'Worn zipper.',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const request=(path,body={},headers={})=>new Request(ORIGIN+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const context=(request,env={GEAR_DB:{}})=>({request,env});
const mailEnv=db=>({GEAR_DB:db,GEAR_RESEND_API_KEY:'test_key'});
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...sample,...patch},now),receipt=await issueLocalVerification(db,draft.id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return draft.id;}

test('production verification issuance preserves the local-only delivery marker',async()=>{
  const db=openLocalDatabase();try{
    const first=await createDraft(db,sample,100),production=await issueVerification(db,first.id,200);
    assert.deepEqual(Object.keys(production).sort(),['expiresAt','recipient','token']);assert.equal(production.recipient,sample.email);assert.match(production.token,/^[a-f0-9]{64}$/);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens WHERE listing_id=?').get(first.id).issue_count,1);
    const second=await createDraft(db,{...sample,title:'Second item'},100),local=await issueLocalVerification(db,second.id,200);
    assert.equal(local.delivery,'local-simulation');assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_verification_tokens').all()).includes(production.token),false);
  }finally{db.close();}
});

test('verification mail sends a scanner-safe bounded fragment link',async()=>{
  let target,options;
  assert.deepEqual(await sendVerificationLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'test_key'},{fetcher:async(...args)=>{[target,options]=args;return Response.json({id:RESPONSE_ID});}}),{id:RESPONSE_ID});
  assert.equal(target,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer test_key');
  assert.match(options.headers['Idempotency-Key'],/^gear-verification-[a-f0-9]{64}$/);assert.equal(options.headers['Idempotency-Key'].includes(TOKEN),false);
  const body=JSON.parse(options.body);assert.deepEqual(body.to,[sample.email]);assert.equal(body.from,'Post & In Gear <gear@postandin.com>');assert.ok(body.text.includes(`/gear/#verification=${TOKEN}`));assert.ok(body.text.includes('Opening it does not publish anything'));
  assert.equal(JSON.stringify(options.headers).includes(TOKEN),false);
});

test('verification mail configuration, input, timeout and provider failures stay private',async()=>{
  const cases=[
    [{},async()=>Response.json({id:RESPONSE_ID}),'config',true,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'bad key'},async()=>Response.json({id:RESPONSE_ID}),'config',true,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('private',{status:400}),'status:400',true,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('private',{status:503}),'status:503',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response(null,{status:302,headers:{Location:'https://example.test'}}),'status:302',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('x'.repeat(4097)),'response',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>new Response('{'),'response',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>Response.json({id:'bad'}),'response',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>{throw new Error('private');},'network',false,{recipient:sample.email,token:TOKEN}],
    [{GEAR_RESEND_API_KEY:'key'},async()=>Response.json({id:RESPONSE_ID}),'input',true,{recipient:'victim@example.test\r\nBcc:x@example.test',token:TOKEN}],
  ];
  for(const [env,fetcher,code,releasable,receipt] of cases)await assert.rejects(sendVerificationLink(receipt,env,{fetcher}),error=>error instanceof GearVerificationMailUnavailableError&&error.message==='Gear verification mail unavailable.'&&error.code===code&&error.releasable===releasable);
  await assert.rejects(sendVerificationLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'key'},{timeoutMs:1,fetcher:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private timeout'))))}),error=>error instanceof GearVerificationMailUnavailableError&&error.code==='network');
  await assert.rejects(sendVerificationLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'key'},{timeoutMs:5,fetcher:async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new Error('private stalled body')),{once:true});}}))}),error=>error instanceof GearVerificationMailUnavailableError&&error.code==='network');
  await assert.rejects(sendVerificationLink({recipient:sample.email,token:TOKEN},{GEAR_RESEND_API_KEY:'key'},{timeoutMs:5,fetcher:async()=>new Response(new ReadableStream({start(){}}))}),error=>error instanceof GearVerificationMailUnavailableError&&error.code==='network');
});

test('posting Turnstile verifier requires the dedicated action',async()=>{
  const verify=createTurnstileVerifier({expectedAction:'gear-post',fetchImpl:async()=>Response.json({success:true,hostname:'postandin.com',action:'gear-post'})});
  assert.equal(await verify('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),true);
  for(const result of [{success:true,hostname:'postandin.com',action:'gear-report'},{success:true,hostname:'example.test',action:'gear-post'}]){
    const mismatch=createTurnstileVerifier({expectedAction:'gear-post',fetchImpl:async()=>Response.json(result)});
    await assert.rejects(mismatch('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),error=>error instanceof GearTurnstileRejectedError&&error.diagnostic===true);
  }
});

test('draft route validates, verifies and creates one unverified draft',async()=>{
  const db=openLocalDatabase();try{
    const tokens=[],handler=createDraftSubmissionHandler({verify:async token=>tokens.push(token),now:()=>100});
    const response=await handler(context(request('/api/gear/drafts',{listing:sample,turnstileToken:'sample-token'}),{GEAR_DB:db}));
    assert.equal(response.status,201);const result=await response.json();assert.match(result.id,/^[a-f0-9-]{36}$/);assert.equal(result.status,'unverified');assert.deepEqual(tokens,['sample-token']);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,1);assert.equal((await readPublicListings(db,100)).length,0);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }finally{db.close();}
});

test('draft route rejects bad boundaries and fields before verification or writes',async()=>{
  let verifies=0,creates=0;const handler=createDraftSubmissionHandler({verify:async()=>{verifies++;},create:async()=>{creates++;}}),valid={listing:sample,turnstileToken:'sample-token'};
  const cases=[
    request('/api/gear/drafts',valid,{Origin:'https://example.test'}),
    request('/api/gear/drafts',valid,{'Sec-Fetch-Site':'cross-site'}),
    request('/api/gear/drafts',valid,{'Content-Type':'text/plain'}),request('/api/gear/drafts','{'),
    request('/api/gear/drafts',{listing:{...sample,title:''},turnstileToken:'sample-token'}),
    request('/api/gear/drafts',valid,{'Content-Length':String(24*1024+1)}),
    request('/api/gear/drafts',{...valid,extra:'x'.repeat(25*1024)}),
  ];
  const expected=[403,403,415,400,400,413,413];
  for(let index=0;index<cases.length;index++)assert.equal((await handler(context(cases[index]))).status,expected[index]);
  assert.equal(verifies,0);assert.equal(creates,0);
});

test('draft route maps missing services and failures without leaking internals',async()=>{
  const valid=request('/api/gear/drafts',{listing:sample,turnstileToken:'sample-token'});let response=await createDraftSubmissionHandler()(context(valid,{}));assert.equal(response.status,503);
  response=await createDraftSubmissionHandler({verify:async()=>{throw new GearTurnstileRejectedError();}})(context(request('/api/gear/drafts',{listing:sample,turnstileToken:'bad'})));assert.equal(response.status,400);
  response=await createDraftSubmissionHandler({verify:async()=>{throw new GearTurnstileUnavailableError('private');}})(context(request('/api/gear/drafts',{listing:sample,turnstileToken:'x'})));assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
  response=await createDraftSubmissionHandler({verify:async()=>{},create:async()=>{throw new Error('private D1 detail');}})(context(request('/api/gear/drafts',{listing:sample,turnstileToken:'x'})));assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
});

test('draft route with D1 but no Turnstile secret fails before writing',async()=>{
  const db=openLocalDatabase();try{
    const response=await createDraftSubmissionHandler()(context(request('/api/gear/drafts',{listing:sample,turnstileToken:'sample-token'}),{GEAR_DB:db}));
    assert.equal(response.status,503);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,0);
  }finally{db.close();}
});

test('production delivery enforces one-minute cooldown and five-message cap per draft',async()=>{
  const db=openLocalDatabase();try{
    const draft=await createDraft(db,sample,0),sent=[];let now=100;
    const handler=createVerificationRequestHandler({send:async receipt=>sent.push(receipt),configured:()=>true,now:()=>now});
    let response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(sent.length,1);
    now++;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(sent.length,1);
    for(let count=2;count<=VERIFICATION_MAX_ISSUES;count++){now=100+(count-1)*VERIFICATION_REISSUE_COOLDOWN_MS;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);}
    now+=VERIFICATION_REISSUE_COOLDOWN_MS;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),null);assert.equal(sent.length,VERIFICATION_MAX_ISSUES);
    assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens WHERE listing_id=?').get(draft.id).issue_count,VERIFICATION_MAX_ISSUES);
    assert.throws(()=>db.sqlite.prepare('UPDATE gear_verification_tokens SET issue_count=? WHERE listing_id=?').run(VERIFICATION_MAX_ISSUES+1,draft.id),/CHECK constraint/);
  }finally{db.close();}
});

test('verification request delivers only to the stored recipient and supports retry',async()=>{
  const db=openLocalDatabase();try{
    const draft=await createDraft(db,sample,100),sent=[];let now=200;const handler=createVerificationRequestHandler({send:async receipt=>sent.push(receipt),configured:()=>true,now:()=>now});
    let response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.deepEqual(await response.json(),{message:'Verification email accepted for delivery.'});
    assert.equal(sent.length,1);assert.equal(sent[0].recipient,sample.email);assert.match(sent[0].token,/^[a-f0-9]{64}$/);
    const first=sent[0].token;now+=VERIFICATION_REISSUE_COOLDOWN_MS;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(sent.length,2);assert.notEqual(sent[1].token,first);
  }finally{db.close();}
});

test('verification request rejects unavailable drafts and reports mail failure honestly',async()=>{
  const id=crypto.randomUUID(),logs=[];let releases=0;const saved=console.error;console.error=(...values)=>logs.push(values);
  try{
    let response=await createVerificationRequestHandler({issue:async()=>null,send:async()=>assert.fail('must not send'),configured:()=>true})(context(request('/api/gear/verification/request',{id})));assert.equal(response.status,404);
    response=await createVerificationRequestHandler({issue:async()=>({recipient:sample.email,token:TOKEN}),release:async()=>{releases++;return true;},send:async()=>{throw new GearVerificationMailUnavailableError('status:503');},configured:()=>true})(context(request('/api/gear/verification/request',{id})));assert.equal(response.status,503);const text=await response.text();assert.ok(text.includes('draft is saved'));assert.equal(text.includes(TOKEN),false);assert.equal(releases,0);
    response=await createVerificationRequestHandler({issue:async()=>({recipient:sample.email,token:TOKEN}),release:async()=>{releases++;return true;},send:async()=>{throw new GearVerificationMailUnavailableError('status:400',{releasable:true});},configured:()=>true})(context(request('/api/gear/verification/request',{id})));assert.equal(response.status,503);assert.equal(releases,1);assert.equal(JSON.stringify(logs).includes(sample.email),false);
    for(const bad of ['bad','00000000-0000-0000-0000-000000000000'])assert.equal((await createVerificationRequestHandler()(context(request('/api/gear/verification/request',{id:bad})))).status,400);
    assert.equal((await createVerificationRequestHandler()(context(request('/api/gear/verification/request',{id}),{}))).status,503);
  }finally{console.error=saved;}
});

test('failed delivery releases its count and cooldown without touching a newer token',async()=>{
  const db=openLocalDatabase(),draft=await createDraft(db,sample,0),tokens=[];let now=100000,fail=true;
  const handler=createVerificationRequestHandler({configured:()=>true,now:()=>now,send:async receipt=>{tokens.push(receipt.token);if(fail)throw new GearVerificationMailUnavailableError('status:400',{releasable:true});}});
  try{
    let response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,503);assert.equal(db.sqlite.prepare('SELECT * FROM gear_verification_tokens').get(),undefined);
    fail=false;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,1);
    now+=VERIFICATION_REISSUE_COOLDOWN_MS;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,2);
    const newer=db.sqlite.prepare('SELECT * FROM gear_verification_tokens WHERE listing_id=?').get(draft.id);assert.equal(await releaseFailedVerificationIssue(db,draft.id,tokens[1],now),false);assert.deepEqual(db.sqlite.prepare('SELECT * FROM gear_verification_tokens WHERE listing_id=?').get(draft.id),newer);
    now+=VERIFICATION_REISSUE_COOLDOWN_MS;fail=true;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,503);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,2);
    fail=false;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,3);
  }finally{db.close();}
});

test('ambiguous provider failures keep the token, cap count and cooldown reserved',async()=>{
  const db=openLocalDatabase(),draft=await createDraft(db,sample,0);let now=100000,fail=true;
  const handler=createVerificationRequestHandler({configured:()=>true,now:()=>now,send:async()=>{if(fail)throw new GearVerificationMailUnavailableError('network');}});
  try{
    let response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,503);
    const reserved=db.sqlite.prepare('SELECT issue_count,created_at FROM gear_verification_tokens WHERE listing_id=?').get(draft.id);assert.deepEqual({...reserved},{issue_count:1,created_at:now});
    fail=false;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,429);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,1);
    now+=VERIFICATION_REISSUE_COOLDOWN_MS;response=await handler(context(request('/api/gear/verification/request',{id:draft.id}),mailEnv(db)));assert.equal(response.status,202);assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens').get().issue_count,2);
  }finally{db.close();}
});

test('missing Resend configuration does not rotate an existing token',async()=>{
  const db=openLocalDatabase();try{
    const draft=await createDraft(db,sample,100),receipt=await issueVerification(db,draft.id,200),before=db.sqlite.prepare('SELECT * FROM gear_verification_tokens WHERE listing_id=?').get(draft.id);
    const response=await createVerificationRequestHandler()(context(request('/api/gear/verification/request',{id:draft.id}),{GEAR_DB:db}));assert.equal(response.status,503);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM gear_verification_tokens WHERE listing_id=?').get(draft.id),before);assert.ok(receipt.token);
  }finally{db.close();}
});

test('production issue and confirmation enforce the three-day draft boundary',async()=>{
  const db=openLocalDatabase();try{
    const exactIssue=await createDraft(db,sample,0),insideIssue=await createDraft(db,{...sample,title:'Inside issue boundary'},1),now=GEAR_DRAFT_RETENTION_MS;
    assert.equal(await issueVerification(db,exactIssue.id,now),null);assert.ok(await issueVerification(db,insideIssue.id,now));
    const exactConfirm=await createDraft(db,{...sample,title:'Exact confirm boundary'},0),insideConfirm=await createDraft(db,{...sample,title:'Inside confirm boundary'},1);
    const exactToken=await issueLocalVerification(db,exactConfirm.id,now-1),insideToken=await issueLocalVerification(db,insideConfirm.id,now-1);
    assert.deepEqual(await confirmVerification(db,exactToken.token,now),{verified:false});assert.equal((await confirmVerification(db,insideToken.token,now)).verified,true);
  }finally{db.close();}
});

test('explicit production confirmation publishes once without creating a session',async()=>{
  const db=openLocalDatabase();try{
    const draft=await createDraft(db,sample,100),receipt=await issueVerification(db,draft.id,200),handler=createVerificationConfirmHandler({now:()=>201});
    assert.equal((await handler(context(request('/api/gear/verification/confirm',{token:receipt.token}),{GEAR_DB:db}))).status,400);
    let response=await handler(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:db}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{verified:true,listingId:draft.id});assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await readPublicListings(db,201)).length,1);response=await handler(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:db}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{verified:true,listingId:draft.id,alreadyVerified:true});
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(draft.id);response=await handler(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:db}));assert.equal(response.status,400);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_sessions').get().n,0);
  }finally{db.close();}
});

test('confirmation route maps expiry, quota and duplicate conflicts to bounded errors',async()=>{
  const expiredDb=openLocalDatabase();try{
    const draft=await createDraft(expiredDb,sample,100),receipt=await issueVerification(expiredDb,draft.id,200),handler=createVerificationConfirmHandler({now:()=>200+TOKEN_TTL_MS});
    assert.equal((await handler(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:expiredDb}))).status,400);
  }finally{expiredDb.close();}
  const quotaDb=openLocalDatabase();try{
    for(let index=0;index<10;index++)await publish(quotaDb,{title:`Quota ${index}`},100);
    const draft=await createDraft(quotaDb,{...sample,title:'Quota blocked'},100),receipt=await issueVerification(quotaDb,draft.id,200);
    assert.equal((await createVerificationConfirmHandler({now:()=>201})(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:quotaDb}))).status,400);
  }finally{quotaDb.close();}
  const duplicateDb=openLocalDatabase();try{
    await publish(duplicateDb,{},100);const draft=await createDraft(duplicateDb,{...sample,description:'Different copy'},100),receipt=await issueVerification(duplicateDb,draft.id,200);
    assert.equal((await createVerificationConfirmHandler({now:()=>201})(context(request('/api/gear/verification/confirm',{token:receipt.token,confirm:true}),{GEAR_DB:duplicateDb}))).status,400);
  }finally{duplicateDb.close();}
});

test('verification routes reject request boundaries before adapters',async()=>{
  let calls=0;const id=crypto.randomUUID(),routes=[
    [createVerificationRequestHandler({issue:async()=>{calls++;return null;},configured:()=>true}),'/api/gear/verification/request',{id}],
    [createVerificationConfirmHandler({confirm:async()=>{calls++;return {verified:false};}}),'/api/gear/verification/confirm',{token:TOKEN,confirm:true}],
  ];
  for(const [handler,path,body] of routes){
    for(const req of [request(path,body,{Origin:'https://example.test'}),request(path,body,{'Sec-Fetch-Site':'cross-site'}),request(path,body,{'Content-Type':'text/plain'}),request(path,'{'),request(path,null),request(path,[]),request(path,{value:'x'.repeat(1100)})])assert.ok([400,403,413,415].includes((await handler(context(req))).status));
  }
  assert.equal(calls,0);
});

test('confirmation requires the JSON boolean true',async()=>{
  let calls=0;const handler=createVerificationConfirmHandler({confirm:async()=>{calls++;return {verified:true};}});
  for(const confirm of [undefined,false,'true',1,null])assert.equal((await handler(context(request('/api/gear/verification/confirm',{token:TOKEN,confirm})))).status,400);
  assert.equal(calls,0);
});

test('verification Pages modules expose only POST handlers and failures remain generic',async()=>{
  for(const route of [draftRoute,requestRoute,confirmRoute])assert.deepEqual(Object.keys(route).filter(key=>key.startsWith('onRequest')),['onRequestPost']);
  const saved=console.error,logs=[];console.error=(...values)=>logs.push(values);
  try{
    let response=await createVerificationConfirmHandler()(context(request('/api/gear/verification/confirm',{token:TOKEN,confirm:true}),{}));assert.equal(response.status,503);
    response=await createVerificationConfirmHandler({confirm:async()=>{throw new Error(`private ${TOKEN} ${sample.email}`);}})(context(request('/api/gear/verification/confirm',{token:TOKEN,confirm:true})));assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
    assert.equal(JSON.stringify(logs).includes(TOKEN),false);assert.equal(JSON.stringify(logs).includes(sample.email),false);assert.equal(JSON.stringify(logs).includes('private'),false);
  }finally{console.error=saved;}
});
