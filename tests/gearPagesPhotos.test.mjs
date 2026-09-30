import test from 'node:test';
import assert from 'node:assert/strict';
import {createGearPhotoFinalizeHandler} from '../functions/api/gear/management/photos/finalize.js';
import {createGearPhotoUploadHandler} from '../functions/api/gear/management/photos/upload.js';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {canRecordPhotoQuarantine,claimPhotoQuarantine,discardClaimedPhoto,queuePhotoDeletionIfUnattached,queuePhotoDeletions,recordPhotoQuarantine} from '../lib/gear-photo-quarantine.mjs';
import {createGearPhotoUpload,sanitizeGearPhoto} from '../lib/gear-pages-photo-service.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com';
const listing=index=>`00000000-0000-4000-8001-${String(index).padStart(12,'0')}`;
const provider=index=>`00000000-0000-4000-8002-${String(index).padStart(12,'0')}`;
const sample={title:'Photo route bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'pages-photo@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...sample,...patch},now);const receipt=await issueLocalVerification(db,draft.id,now);await confirmVerification(db,receipt.token,now);return draft.id;}
async function login(db,email=sample.email,now=150){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
function request(path,body,access,options={}){
  const headers={Origin:ORIGIN,'Content-Type':'application/json',Cookie:`__Host-gear_session=${access?.session??'a'.repeat(64)}`,'X-Gear-CSRF':access?.csrf??'b'.repeat(64),...options.headers};
  return new Request(options.url??ORIGIN+path,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
}
const service=handler=>({fetch:handler});
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const bindings=(db,images)=>({GEAR_DB:db,GEAR_IMAGES:images,GEAR_PHOTO_UPLOADS_ENABLED:'true'});

test('photo quarantine preflight, durable cleanup queue and claimed discard preserve ownership boundaries',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);
    assert.equal(await canRecordPhotoQuarantine(db,access.session,access.csrf,id,200),true);
    assert.equal(await canRecordPhotoQuarantine(db,access.session,'0'.repeat(64),id,200),false);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const claimed=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),201);
    assert.equal(await discardClaimedPhoto(db,provider(1),'0'.repeat(64),[provider(2)],202),false);
    assert.equal(await discardClaimedPhoto(db,provider(1),claimed.claim,[provider(2),'broad_cleanup-ID'],202),true);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines').get().n,0);
    assert.deepEqual(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions ORDER BY provider_id').all().map(row=>row.provider_id),[provider(1),provider(2),'broad_cleanup-ID'].sort());
    assert.equal(await queuePhotoDeletions(db,id,[provider(2),provider(3),provider(3)],203),1);
    assert.equal(await queuePhotoDeletionIfUnattached(db,id,provider(4),203),true);
    db.sqlite.prepare('INSERT INTO gear_photos VALUES(?,?,?,?,?)').run(crypto.randomUUID(),id,provider(5),0,203);
    assert.equal(await queuePhotoDeletionIfUnattached(db,id,provider(5),203),false);
    assert.equal(await queuePhotoDeletions(db,id,[provider(5)],203),0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id=?').get(provider(5)).n,0);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(6),204);
    const second=await claimPhotoQuarantine(db,access.session,access.csrf,provider(6),205);
    assert.equal(await discardClaimedPhoto(db,provider(6),second.claim,[provider(5)],206),true);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id=?').get(provider(6)).n,1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id=?').get(provider(5)).n,0);
    await assert.rejects(queuePhotoDeletions(db,id,['bad/id'],203),/Invalid cleanup/);
  }finally{db.close();}
});

test('authenticated Pages routes create a private upload and attach only the sanitized ID',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);let calls=[];
    const images=service(async req=>{calls.push(new URL(req.url).pathname);
      if(req.url.endsWith('/upload'))return json(201,{quarantineProviderId:provider(1),uploadURL:'https://upload.imagedelivery.net/token'});
      if(req.url.endsWith('/sanitize'))return json(200,{providerId:provider(2),cleanupProviderIds:[]});
      throw new Error('unexpected');
    });
    const upload=createGearPhotoUploadHandler({now:()=>200});
    let response=await upload({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,201);const issued=await response.json();assert.equal(issued.quarantineProviderId,provider(1));assert.ok(issued.uploadURL.startsWith('https://upload.imagedelivery.net/'));
    const finalize=createGearPhotoFinalizeHandler({now:()=>201});
    response=await finalize({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.deepEqual(calls,['/internal/gear/photos/upload','/internal/gear/photos/sanitize']);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photos').get().provider_id,provider(2));
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').get().provider_id,provider(1));
  }finally{db.close();}
});

test('upload route preflights before provider work and compensates a lost D1 reservation',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);let providerCalls=0,deleted=0;
    const images=service(async req=>{providerCalls++;if(req.url.endsWith('/upload'))return json(201,{quarantineProviderId:provider(1),uploadURL:'https://upload.imagedelivery.net/token'});if(req.url.endsWith('/delete')){deleted++;return json(200,{ok:true});}return json(500,{});});
    let response=await createGearPhotoUploadHandler({preflight:async()=>false,now:()=>200})({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,409);assert.equal(providerCalls,0);
    response=await createGearPhotoUploadHandler({preflight:async()=>true,record:async()=>null,now:()=>200})({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,409);assert.equal(deleted,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,0);
    const failing=service(async req=>req.url.endsWith('/upload')?json(201,{quarantineProviderId:provider(3),uploadURL:'https://upload.imagedelivery.net/token'}):json(503,{error:'unavailable'}));
    response=await createGearPhotoUploadHandler({preflight:async()=>true,record:async()=>null,now:()=>201})({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,failing)});
    assert.equal(response.status,409);assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').get().provider_id,provider(3));
  }finally{db.close();}
});

test('upload route consumes the seller budget before provider work and returns a bounded retry',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db);let providerCalls=0;
    const images=service(async()=>{providerCalls++;throw new Error('provider must not run');});
    let response=await createGearPhotoUploadHandler({consume:async()=>({allowed:false,retryAfterSeconds:321}),now:()=>200})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'321');assert.deepEqual(await response.json(),{error:'Too many photo uploads. Try again later.'});assert.equal(providerCalls,0);
    response=await createGearPhotoUploadHandler({consume:async()=>({allowed:false,retryAfterSeconds:86401}),now:()=>200})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(providerCalls,0);
  }finally{db.close();}
});

test('upload route preserves real preflight, provider-failure and exhausted-budget ordering',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db);let providerCalls=0;
    for(let position=0;position<6;position++)db.sqlite.prepare('INSERT INTO gear_photos VALUES(?,?,?,?,?)').run(crypto.randomUUID(),id,provider(position+1),position,190);
    const images=service(async()=>{providerCalls++;return json(503,{error:'unavailable'});});
    const handler=createGearPhotoUploadHandler({now:()=>200});
    let response=await handler({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,409);assert.equal(providerCalls,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_upload_limits').get().n,0);
    db.sqlite.prepare('DELETE FROM gear_photos WHERE listing_id=?').run(id);
    response=await handler({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,503);assert.equal(providerCalls,1);
    assert.equal(db.sqlite.prepare('SELECT attempts FROM gear_photo_upload_limits').get().attempts,1);
    db.sqlite.prepare('UPDATE gear_photo_upload_limits SET attempts=60').run();
    response=await handler({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,429);assert.equal(Number(response.headers.get('retry-after'))>=1,true);assert.equal(providerCalls,1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines').get().n,0);
  }finally{db.close();}
});

test('upload route maps authorization lost between preflight and budget consumption to listing conflict',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db);let providerCalls=0;
    const preflight=async(database,session,csrf,listingId,now)=>{
      const allowed=await canRecordPhotoQuarantine(database,session,csrf,listingId,now);
      database.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=? WHERE session_hash IS NOT NULL').run(now);
      return allowed;
    };
    const response=await createGearPhotoUploadHandler({preflight,now:()=>200})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,service(async()=>{providerCalls++;return json(500,{});}))});
    assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'This listing cannot accept another photo.'});assert.equal(providerCalls,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_upload_limits').get().n,0);
  }finally{db.close();}
});

test('upload route compensates a thrown reservation and keeps outbox failures generic',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),images=service(async req=>req.url.endsWith('/upload')
      ?json(201,{quarantineProviderId:provider(1),uploadURL:'https://upload.imagedelivery.net/token'}):json(503,{error:'unavailable'}));
    let response=await createGearPhotoUploadHandler({record:async()=>{throw new Error('private reservation detail');},now:()=>200})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').get().provider_id,provider(1));
    response=await createGearPhotoUploadHandler({create:async()=>({kind:'unavailable',cleanupProviderIds:[provider(2)]}),queue:async()=>{throw new Error('private queue detail');},now:()=>201})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,500);assert.equal((await response.text()).includes(provider(2)),false);
  }finally{db.close();}
});

test('an ambiguous committed reservation is bounded and compensated without deleting its D1 evidence',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);let deleted=0;
    const images=service(async req=>req.url.endsWith('/upload')?json(201,{quarantineProviderId:provider(1),uploadURL:'https://upload.imagedelivery.net/token'}):json(200,{ok:++deleted>0}));
    const record=async(...args)=>{await recordPhotoQuarantine(...args);throw new Error('lost D1 response');};
    const response=await createGearPhotoUploadHandler({record,now:()=>200})
      ({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,500);assert.equal(deleted,1);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_quarantines').get().provider_id,provider(1));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,0);
  }finally{db.close();}
});

test('create-time cleanup references are durably queued before a retryable response',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),images=service(async()=>json(503,{error:'unavailable',cleanupProviderIds:[provider(4),'broad_cleanup-ID']}));
    const response=await createGearPhotoUploadHandler({now:()=>200})({request:request('/api/gear/management/photos/upload',{listingId:id},access),env:bindings(db,images)});
    assert.equal(response.status,503);assert.equal((await response.text()).includes(provider(4)),false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,2);
  }finally{db.close();}
});

test('finalize releases retryable claims and consumes terminal failures into cleanup',async()=>{
  for(const [kind,status] of [['pending',409],['unavailable',503]]){
    const db=openLocalDatabase();
    try{
      const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
      const images=service(async()=>json(status,{error:kind}));
      const response=await createGearPhotoFinalizeHandler({now:()=>201})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
      assert.equal(response.status,status);assert.equal(db.sqlite.prepare('SELECT claim_hash FROM gear_photo_quarantines').get().claim_hash,null);
    }finally{db.close();}
  }
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const images=service(async()=>json(422,{error:'rejected',cleanupProviderIds:[provider(2)]}));
    const response=await createGearPhotoFinalizeHandler({now:()=>201})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,422);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,2);
  }finally{db.close();}
});

test('finalize retries an indeterminate attachment and never exposes or compensates an attached image',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);let attempts=0;
    const actual=(await import('../lib/gear-photo-quarantine.mjs')).attachClaimedPhoto;
    const attach=async(...args)=>{attempts++;const result=await actual(...args);if(attempts===1)throw new Error('lost response');return result;};
    const images=service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:[]}));
    const response=await createGearPhotoFinalizeHandler({attach,now:()=>201})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,200);assert.equal(attempts,2);assert.equal((await response.text()).includes(provider(2)),false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos WHERE provider_id=?').get(provider(2)).n,1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id=?').get(provider(2)).n,0);
  }finally{db.close();}
});

test('successful attachment is not blocked by redundant cleanup staging failure',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const images=service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:[provider(1)]}));
    const response=await createGearPhotoFinalizeHandler({queue:async()=>{throw new Error('private cleanup detail');},now:()=>201})
      ({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,200);assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photos').get().provider_id,provider(2));
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').get().provider_id,provider(1));
  }finally{db.close();}
});

test('double attachment failure conditionally queues only an unattached sanitized image',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const images=service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:[]}));let attempts=0;
    const response=await createGearPhotoFinalizeHandler({attach:async()=>{attempts++;throw new Error('private D1 outage');},now:()=>201})
      ({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,500);assert.equal(attempts,2);assert.equal((await response.text()).includes('private'),false);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').get().provider_id,provider(2));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos').get().n,0);
    assert.notEqual(db.sqlite.prepare('SELECT claim_hash FROM gear_photo_quarantines').get().claim_hash,null);
  }finally{db.close();}
});

test('terminal discard fallback queues both IDs without changing photos',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const images=service(async()=>json(422,{error:'rejected',cleanupProviderIds:[provider(2)]}));
    const response=await createGearPhotoFinalizeHandler({discard:async()=>false,now:()=>201})
      ({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,422);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id IN (?,?)').get(provider(1),provider(2)).n,2);
  }finally{db.close();}
});

test('a retryable release failure stays generic and preserves the claim for bounded recovery',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    const images=service(async()=>json(409,{error:'pending'}));let releases=0;
    const response=await createGearPhotoFinalizeHandler({release:async()=>{releases++;throw new Error('private release detail');},now:()=>201})
      ({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,500);assert.equal(releases,2);assert.equal((await response.text()).includes('private'),false);
    assert.notEqual(db.sqlite.prepare('SELECT claim_hash FROM gear_photo_quarantines').get().claim_hash,null);
  }finally{db.close();}
});

test('service-contract drift preserves valid cleanup references and bounds responses',async()=>{
  let result=await createGearPhotoUpload(service(async()=>json(201,{quarantineProviderId:provider(1),uploadURL:'http://upload.imagedelivery.net/token'})));
  assert.deepEqual(result,{kind:'unavailable',cleanupProviderIds:[provider(1)]});
  result=await sanitizeGearPhoto(service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:[],extra:true})),provider(1));
  assert.deepEqual(result,{kind:'rejected',cleanupProviderIds:[provider(2)]});
  result=await sanitizeGearPhoto(service(async()=>json(200,{providerId:provider(1),cleanupProviderIds:[]})),provider(1));
  assert.deepEqual(result,{kind:'rejected',cleanupProviderIds:[provider(1)]});
  result=await sanitizeGearPhoto(service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:Array.from({length:9},(_,i)=>`cleanup_${i}`)})),provider(1));
  assert.deepEqual(result,{kind:'rejected',cleanupProviderIds:[provider(2)]});
  result=await createGearPhotoUpload(service(async()=>new Response('{}',{status:201,headers:{'Content-Type':'text/plain'}})));
  assert.deepEqual(result,{kind:'unavailable',cleanupProviderIds:[]});
  result=await createGearPhotoUpload(service(async()=>new Response('{}',{status:201,headers:{'Content-Type':'application/json','Content-Length':'2049'}})));
  assert.deepEqual(result,{kind:'unavailable',cleanupProviderIds:[]});
});

test('real access probe rejects invalid session states before provider work and flags fail closed',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),images=service(async()=>{throw new Error('provider must not run');});
    const upload=createGearPhotoUploadHandler({now:()=>200}),uploadRequest=csrf=>request('/api/gear/management/photos/upload',{listingId:id},access,{headers:{'X-Gear-CSRF':csrf}});
    let response=await upload({request:uploadRequest('0'.repeat(64)),env:bindings(db,images)});assert.equal(response.status,401);
    db.sqlite.prepare('UPDATE gear_management_sessions SET created_at=201,expires_at=300').run();
    response=await upload({request:uploadRequest(access.csrf),env:bindings(db,images)});assert.equal(response.status,401);
    db.sqlite.prepare('UPDATE gear_management_sessions SET created_at=100,expires_at=200').run();
    response=await upload({request:uploadRequest(access.csrf),env:bindings(db,images)});assert.equal(response.status,401);
    db.sqlite.prepare('UPDATE gear_management_sessions SET created_at=100,expires_at=300,revoked_at=199').run();
    response=await upload({request:uploadRequest(access.csrf),env:bindings(db,images)});assert.equal(response.status,401);
    const disabled={...bindings(db,images),GEAR_PHOTO_UPLOADS_ENABLED:'TRUE'};
    response=await upload({request:uploadRequest(access.csrf),env:disabled});assert.equal(response.status,503);
    response=await createGearPhotoFinalizeHandler({now:()=>200})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:disabled});
    assert.equal(response.status,503);
  }finally{db.close();}
});

test('committed finalize replay and concurrent claim do not call the service twice',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);let calls=0,unblock,started;
    const began=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{unblock=resolve;});
    const images=service(async()=>{calls++;started();await gate;return json(200,{providerId:provider(2),cleanupProviderIds:[]});});
    const handler=createGearPhotoFinalizeHandler({now:()=>201}),context={request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)};
    const first=handler(context);await began;
    let response=await handler({...context,request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access)});
    assert.equal(response.status,409);assert.equal(calls,1);unblock();assert.equal((await first).status,200);
    response=await handler({...context,request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access)});
    assert.equal(response.status,409);assert.equal(calls,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos').get().n,1);
  }finally{db.close();}
});

test('finalize compensates a confirmed attachment rejection and malformed service success',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),200);
    let images=service(async()=>json(200,{providerId:provider(2),cleanupProviderIds:[]}));
    let response=await createGearPhotoFinalizeHandler({attach:async()=>null,now:()=>201})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},access),env:bindings(db,images)});
    assert.equal(response.status,409);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id IN (?,?)').get(provider(1),provider(2)).n,2);

    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(3),202);
    images=service(async()=>json(200,{providerId:provider(4),cleanupProviderIds:[provider(4)]}));
    response=await createGearPhotoFinalizeHandler({now:()=>203})({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(3)},access),env:bindings(db,images)});
    assert.equal(response.status,422);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines WHERE provider_id=?').get(provider(3)).n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE provider_id IN (?,?)').get(provider(3),provider(4)).n,2);
  }finally{db.close();}
});

test('photo routes reject invalid transport and service responses without provider or D1 writes',async()=>{
  let creates=0,claims=0;const upload=createGearPhotoUploadHandler({access:async()=>true,preflight:async()=>{creates++;return true;},consume:async()=>({allowed:true})}),finalize=createGearPhotoFinalizeHandler({access:async()=>true,claim:async()=>{claims++;return null;}}),env=bindings({},service(async()=>json(200,{private:'detail'})));
  assert.equal((await upload({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null,{url:'https://preview.pages.dev/api/gear/management/photos/upload'}),env})).status,403);
  assert.equal((await upload({request:request('/api/gear/management/photos/upload',{listingId:'bad'},null),env})).status,400);
  assert.equal((await finalize({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:'bad'},null),env})).status,400);
  assert.equal(creates,0);assert.equal(claims,0);
  const response=await createGearPhotoUploadHandler({access:async()=>true,preflight:async()=>true,consume:async()=>({allowed:true})})({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null),env});
  assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
  assert.equal((await upload({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null,{headers:{Cookie:''}}),env})).status,401);
  assert.equal((await finalize({request:request('/api/gear/management/photos/finalize',{quarantineProviderId:provider(1)},null,{headers:{'X-Gear-CSRF':''}}),env})).status,403);
  assert.equal((await upload({request:request('/api/gear/management/photos/upload','{',null),env})).status,400);
  assert.equal((await upload({request:request('/api/gear/management/photos/upload',{listingId:listing(1),extra:'x'.repeat(1100)},null),env})).status,413);
  assert.equal((await createGearPhotoUploadHandler()({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null),env:{}})).status,503);
  assert.equal((await createGearPhotoUploadHandler({access:async()=>false})({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null),env})).status,401);
  assert.equal((await createGearPhotoUploadHandler({access:async()=>true})({request:request('/api/gear/management/photos/upload',{listingId:listing(1)},null),env:{GEAR_DB:{},GEAR_IMAGES:env.GEAR_IMAGES}})).status,503);
});
