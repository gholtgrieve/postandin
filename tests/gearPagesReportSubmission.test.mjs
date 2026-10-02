import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {submitReport} from '../lib/gear-report-storage.mjs';
import {createReportSubmissionHandler,onRequestPost} from '../functions/api/gear/reports.js';
import {createTurnstileVerifier,GearTurnstileRejectedError,GearTurnstileUnavailableError} from '../lib/gear-turnstile.mjs';

const sample={title:'Sample bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const reportId='00000000-0000-4000-8000-000000000001';
async function publish(db,now=100){const {id}=await createDraft(db,sample,now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
const body=(id,patch={})=>({id,reason:'Other concern',turnstileToken:'sample-token',...patch});
const request=(value,options={})=>new Request(options.url??'https://postandin.com/api/gear/reports',{
  method:'POST',
  headers:{Origin:'https://postandin.com','Content-Type':'application/json',...options.headers},
  body:typeof value==='string'?value:JSON.stringify(value),
});

test('production report insert atomically requires a currently public listing',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),now=200;
    assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},now,reportId),true);
    assert.deepEqual({...db.sqlite.prepare('SELECT id,listing_id,listing_title,reason,created_at,resolution FROM gear_reports').get()},{id:reportId,listing_id:id,listing_title:sample.title,reason:'Other concern',created_at:now,resolution:'open'});
    db.sqlite.prepare("UPDATE gear_listings SET status='pending' WHERE id=?").run(id);
    assert.equal(await submitReport(db,{listingId:id,reason:'Prohibited item'},now+1,'00000000-0000-4000-8000-000000000002'),true);
    for(const status of ['unverified','closed','expired','removed']){
      db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(status,id);
      assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},now+2,crypto.randomUUID()),false);
    }
    db.sqlite.prepare("UPDATE gear_listings SET status='available',expires_at=? WHERE id=?").run(now,id);
    assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},now,crypto.randomUUID()),false);
    db.sqlite.prepare('UPDATE gear_listings SET expires_at=?,verified_at=100 WHERE id=?').run(now+1,id);db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL').run();
    assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},now,crypto.randomUUID()),false);
    assert.equal(await submitReport(db,{listingId:crypto.randomUUID(),reason:'Other concern'},now,crypto.randomUUID()),false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_reports').get().n,2);
  }finally{db.close();}
});

test('public report route accepts verified JSON and stores only report fields',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),tokens=[];
    const handler=createReportSubmissionHandler({verify:async token=>tokens.push(token),now:()=>200,randomUUID:()=>reportId});
    const response=await handler({request:request(body(id,{email:'ignore@example.test',status:'removed'})),env:{GEAR_DB:db,GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(await response.json(),{ok:true,message:'Report submitted for review.'});
    assert.deepEqual(tokens,['sample-token']);
    const stored=JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_reports').all());
    assert.equal(stored.includes('@'),false);assert.equal(stored.includes('removed'),false);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_reports').get().n,1);
  }finally{db.close();}
});

test('public report route rejects cross-origin, non-JSON, malformed and oversized requests before verification',async()=>{
  let verifies=0,submits=0;const handler=createReportSubmissionHandler({verify:async()=>{verifies++;},submit:async()=>{submits++;return true;}}),id=crypto.randomUUID();
  const cases=[
    request(body(id),{url:'https://www.postandin.com/api/gear/reports'}),
    request(body(id),{headers:{Origin:'https://example.test'}}),
    new Request('https://postandin.com/api/gear/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body(id))}),
    request(body(id),{headers:{'Sec-Fetch-Site':'cross-site'}}),
    request(body(id),{headers:{'Content-Type':'text/plain'}}),
    request('{'),
    new Request('https://postandin.com/api/gear/reports',{method:'POST',headers:{Origin:'https://postandin.com','Content-Type':'application/json'},body:new Uint8Array([0xff])}),
    request({}),
    request(body('bad')),
    request(body(id,{reason:'Unsupported'})),
    request(body(id,{turnstileToken:null})),
    request(body(id),{headers:{'Content-Length':'4097'}}),
    request({...body(id),extra:'x'.repeat(5000)}),
  ];
  const expected=[403,403,403,403,415,400,400,400,400,400,400,413,413];
  for(let index=0;index<cases.length;index++)assert.equal((await handler({request:cases[index],env:{GEAR_DB:{}}})).status,expected[index]);
  assert.equal(verifies,0);assert.equal(submits,0);
});

test('Turnstile verifier requires configured secret, exact hostname/action and bounded successful response',async()=>{
  const calls=[];
  const valid=createTurnstileVerifier({fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({success:true,hostname:'postandin.com',action:'gear-report'});}});
  assert.equal(await valid('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),true);
  assert.equal(calls[0].url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.signal instanceof AbortSignal,true);
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.secret,'sample-secret');assert.equal(payload.response,'sample-token');assert.match(payload.idempotency_key,/^[a-f0-9-]{36}$/);assert.equal('remoteip' in payload,false);
  for(const result of [{success:false,'error-codes':['invalid-input-response']},{success:true,hostname:'example.test',action:'gear-report'},{success:true,hostname:'postandin.com',action:'other'}]){
    const verify=createTurnstileVerifier({fetchImpl:async()=>Response.json(result)});await assert.rejects(verify('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),GearTurnstileRejectedError);
  }
  for(const token of ['',`x`.repeat(2049),'contains space','line\nbreak'])await assert.rejects(valid(token,{GEAR_TURNSTILE_SECRET:'sample-secret'}),GearTurnstileRejectedError);
  await assert.rejects(valid('sample-token',{}),GearTurnstileUnavailableError);
  for(const fetchImpl of [
    async()=>Response.json({success:false,'error-codes':['internal-error']}),
    async()=>new Response(null,{status:302,headers:{Location:'https://example.test'}}),
    async()=>new Response('x',{headers:{'Content-Length':String(16*1024+1)}}),
    async()=>new Response(new Uint8Array(16*1024+1)),
    async()=>new Response('not json'),
    async()=>{throw new Error('private network detail');},
  ]){
    const verify=createTurnstileVerifier({fetchImpl});await assert.rejects(verify('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),GearTurnstileUnavailableError);
  }
  const timeout=createTurnstileVerifier({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(timeout('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),GearTurnstileUnavailableError);
});

test('public report route maps verification, binding, eligibility and D1 failures safely',async()=>{
  const logged=console.error,warned=console.warn,errors=[],warnings=[];console.error=(...args)=>errors.push(args);console.warn=(...args)=>warnings.push(args);const id=crypto.randomUUID();
  try{
    let verifies=0,submits=0,response;
    for(const env of [{},{GEAR_DB:{}},{GEAR_DB:{},GEAR_REPORTS_ENABLED:'TRUE'}]){
      response=await createReportSubmissionHandler({verify:async()=>{verifies++;},submit:async()=>{submits++;return true;}})({request:request(body(id)),env});
      assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Reports are temporarily unavailable.'});
    }
    assert.equal(verifies,0);assert.equal(submits,0);
    response=await createReportSubmissionHandler({verify:async()=>{throw new GearTurnstileRejectedError();}})({request:request(body(id)),env:{GEAR_DB:{},GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'Complete the verification and try again.'});
    response=await createReportSubmissionHandler({verify:async()=>{throw new GearTurnstileRejectedError({diagnostic:true});}})({request:request(body(id)),env:{GEAR_DB:{},GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,400);assert.equal(warnings.length,1);assert.equal(JSON.stringify(warnings).includes('sample-token'),false);
    response=await createReportSubmissionHandler({verify:async()=>{throw new GearTurnstileUnavailableError('private');}})({request:request(body(id)),env:{GEAR_DB:{},GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Reports are temporarily unavailable.'});
    response=await createReportSubmissionHandler({verify:async()=>{},submit:async()=>false})({request:request(body(id)),env:{GEAR_DB:{},GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'This listing is no longer available to report.'});
    response=await createReportSubmissionHandler({verify:async()=>{},submit:async()=>{throw new Error('private database detail');}})({request:request(body(id)),env:{GEAR_DB:{},GEAR_REPORTS_ENABLED:'true'}});
    const failed=await response.json();assert.equal(response.status,500);assert.deepEqual(failed,{error:'Unable to submit this report right now.'});assert.equal(JSON.stringify(failed).includes('private'),false);
    assert.equal(errors.some(entry=>String(entry.at(-1)).includes('private database detail')),true);
    let prepared=false;
    response=await onRequestPost({request:request(body(id)),env:{GEAR_DB:{prepare(){prepared=true;throw new Error('D1 should not run');}},GEAR_REPORTS_ENABLED:'true'}});
    assert.equal(response.status,503);assert.equal(prepared,false);
  }finally{console.error=logged;console.warn=warned;}
});
