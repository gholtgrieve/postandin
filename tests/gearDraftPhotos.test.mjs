import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftPhotoFinalizeHandler} from '../functions/api/gear/drafts/photos/finalize.js';
import {createDraftPhotoUploadHandler} from '../functions/api/gear/drafts/photos/upload.js';
import {GEAR_DRAFT_RETENTION_MS} from '../lib/gear-exchange.mjs';
import {
  attachClaimedDraftPhoto,canRecordDraftPhoto,claimDraftPhotoQuarantine,
  hasDraftPhotoAccess,issueDraftPhotoAccess,recordDraftPhotoQuarantine,
} from '../lib/gear-draft-photos.mjs';
import {createDraft,readPublicListings,readPublicListingsWithPhotoRefs} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification} from '../lib/gear-verification.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com';
const provider=index=>`00000000-0000-4000-8003-${String(index).padStart(12,'0')}`;
const sample={title:'Draft photo bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'draft-photo@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
const service=handler=>({fetch:handler});
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const request=(path,body,headers={})=>new Request(ORIGIN+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const bindings=(db,images)=>({GEAR_DB:db,GEAR_IMAGES:images,GEAR_PHOTO_UPLOADS_ENABLED:'true'});

test('draft photo bearer attaches a private photo and is destroyed at verification',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100),access=await issueDraftPhotoAccess(db,created.id,101);
    assert.match(access.token,/^[a-f0-9]{64}$/);assert.equal(await hasDraftPhotoAccess(db,access.token,101),true);
    assert.equal(await hasDraftPhotoAccess(db,'0'.repeat(64),101),false);assert.equal(await canRecordDraftPhoto(db,access.token,created.id,101),true);
    assert.ok(await recordDraftPhotoQuarantine(db,access.token,created.id,provider(1),102));
    const claimed=await claimDraftPhotoQuarantine(db,access.token,provider(1),103);assert.equal(claimed.listingId,created.id);
    assert.deepEqual(await attachClaimedDraftPhoto(db,access.token,provider(1),claimed.claim,provider(2),104),{ok:true});
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photos WHERE listing_id=?').get(created.id).provider_id,provider(2));
    assert.equal((await readPublicListings(db,104)).length,0);
    const receipt=await issueLocalVerification(db,created.id,105);assert.equal((await confirmVerification(db,receipt.token,106)).verified,true);
    assert.equal(await hasDraftPhotoAccess(db,access.token,106),false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_draft_photo_access WHERE listing_id=?').get(created.id).n,0);
    const publicListings=await readPublicListingsWithPhotoRefs(db,106);assert.equal(publicListings.length,1);assert.equal(publicListings[0].photoRefs[0].providerId,provider(2));
  }finally{db.close();}
});

test('draft photo bearer is listing-scoped, six-photo bounded and expires with the draft',async()=>{
  const db=openLocalDatabase();
  try{
    const first=await createDraft(db,sample,100),second=await createDraft(db,{...sample,title:'Second draft'},100);
    const access=await issueDraftPhotoAccess(db,first.id,101);
    assert.equal(await canRecordDraftPhoto(db,access.token,second.id,101),false);
    assert.equal(await issueDraftPhotoAccess(db,second.id,100+GEAR_DRAFT_RETENTION_MS),null);
    for(let index=1;index<=6;index++)assert.ok(await recordDraftPhotoQuarantine(db,access.token,first.id,provider(index),102));
    assert.equal(await canRecordDraftPhoto(db,access.token,first.id,102),false);
    assert.equal(await recordDraftPhotoQuarantine(db,access.token,first.id,provider(7),102),null);
    assert.equal(await hasDraftPhotoAccess(db,access.token,101+GEAR_DRAFT_RETENTION_MS),false);
  }finally{db.close();}
});

test('draft photo Pages routes accept only the scoped token and attach the sanitized image',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100),access=await issueDraftPhotoAccess(db,created.id,101);let calls=[];
    const images=service(async req=>{calls.push(new URL(req.url).pathname);if(req.url.endsWith('/upload'))return json(201,{quarantineProviderId:provider(1),uploadURL:'https://upload.imagedelivery.net/token'});if(req.url.endsWith('/sanitize'))return json(200,{providerId:provider(2),cleanupProviderIds:[]});throw new Error('unexpected');});
    const upload=createDraftPhotoUploadHandler({now:()=>102});
    let response=await upload({request:request('/api/gear/drafts/photos/upload',{listingId:created.id,draftToken:'0'.repeat(64)}),env:bindings(db,images)});assert.equal(response.status,401);assert.equal(calls.length,0);
    response=await upload({request:request('/api/gear/drafts/photos/upload',{listingId:created.id,draftToken:access.token}),env:bindings(db,images)});assert.equal(response.status,201);const issued=await response.json();assert.equal(issued.quarantineProviderId,provider(1));
    const finalize=createDraftPhotoFinalizeHandler({now:()=>103});
    response=await finalize({request:request('/api/gear/drafts/photos/finalize',{quarantineProviderId:provider(1),draftToken:access.token}),env:bindings(db,images)});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    assert.deepEqual(calls,['/internal/gear/photos/upload','/internal/gear/photos/sanitize']);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photos WHERE listing_id=?').get(created.id).provider_id,provider(2));
  }finally{db.close();}
});
