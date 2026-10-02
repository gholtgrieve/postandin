import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftPhotoFinalizeHandler} from '../functions/api/gear/drafts/photos/finalize.js';
import {createDraftPhotoRemoveHandler} from '../functions/api/gear/drafts/photos/remove.js';
import {createDraftPhotoReorderHandler} from '../functions/api/gear/drafts/photos/reorder.js';
import {createDraftPhotoUploadHandler} from '../functions/api/gear/drafts/photos/upload.js';
import {createDraftUpdateHandler} from '../functions/api/gear/drafts/update.js';
import {GEAR_DRAFT_RETENTION_MS} from '../lib/gear-exchange.mjs';
import {
  attachClaimedDraftPhoto,canRecordDraftPhoto,claimDraftPhotoQuarantine,removeDraftPhoto,reorderDraftPhotos,
  hasDraftListingAccess,hasDraftPhotoAccess,issueDraftPhotoAccess,recordDraftPhotoQuarantine,
} from '../lib/gear-draft-photos.mjs';
import {createDraft,readLocalDraft,readPublicListings,readPublicListingsWithPhotoRefs,updateDraft} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification,issueVerification,VERIFICATION_MAX_ISSUES,VERIFICATION_REISSUE_COOLDOWN_MS} from '../lib/gear-verification.mjs';
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
    const attached=await attachClaimedDraftPhoto(db,access.token,provider(1),claimed.claim,provider(2),104);assert.equal(attached.ok,true);assert.match(attached.photoId,/^[a-f0-9-]{36}$/);
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

test('private draft details can be revised through the scoped draft credential without becoming public',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100),access=await issueDraftPhotoAccess(db,created.id,101);
    assert.equal(await hasDraftListingAccess(db,access.token,created.id,102),true);
    const oldReceipt=await issueLocalVerification(db,created.id,101),changed={...sample,title:'Updated private bag',email:'new-draft@example.test',clubs:['Kent Valley']};
    const handler=createDraftUpdateHandler({now:()=>102});
    let response=await handler({request:request('/api/gear/drafts/update',{listingId:created.id,draftToken:access.token,listing:changed}),env:{GEAR_DB:db}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    const saved=await readLocalDraft(db,created.id);assert.equal(saved.title,changed.title);assert.equal(saved.email,changed.email);assert.deepEqual(saved.clubs,['Kent Valley']);assert.deepEqual(await readPublicListings(db,102),[]);
    assert.deepEqual(await confirmVerification(db,oldReceipt.token,103),{verified:false});
    response=await handler({request:request('/api/gear/drafts/update',{listingId:created.id,draftToken:'0'.repeat(64),listing:changed}),env:{GEAR_DB:db}});assert.equal(response.status,401);
    response=await handler({request:request('/api/gear/drafts/update',{listingId:created.id,draftToken:access.token,listing:{...changed,title:''}}),env:{GEAR_DB:db}});assert.equal(response.status,400);
    response=await createDraftUpdateHandler({now:()=>101+GEAR_DRAFT_RETENTION_MS})({request:request('/api/gear/drafts/update',{listingId:created.id,draftToken:access.token,listing:changed}),env:{GEAR_DB:db}});assert.equal(response.status,401);
  }finally{db.close();}
});

test('revising a private draft invalidates old links without resetting the verification email cap',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100);let lastToken;
    for(let index=0;index<VERIFICATION_MAX_ISSUES;index++){
      const now=200+index*VERIFICATION_REISSUE_COOLDOWN_MS,receipt=await issueVerification(db,created.id,now);lastToken=receipt.token;
      assert.equal(await updateDraft(db,created.id,{...sample,title:`Revision ${index}`,email:`revision-${index}@example.test`},now+1),true);
      assert.equal(db.sqlite.prepare('SELECT issue_count FROM gear_verification_tokens WHERE listing_id=?').get(created.id).issue_count,index+1);
      assert.deepEqual(await confirmVerification(db,lastToken,now+2),{verified:false});
    }
    assert.deepEqual(await issueVerification(db,created.id,200+VERIFICATION_MAX_ISSUES*VERIFICATION_REISSUE_COOLDOWN_MS),{limited:true,reason:'cap'});
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
    response=await finalize({request:request('/api/gear/drafts/photos/finalize',{quarantineProviderId:provider(1),draftToken:access.token}),env:bindings(db,images)});assert.equal(response.status,200);const finalized=await response.json();assert.equal(finalized.ok,true);assert.match(finalized.photoId,/^[a-f0-9-]{36}$/);
    assert.deepEqual(calls,['/internal/gear/photos/upload','/internal/gear/photos/sanitize']);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photos WHERE listing_id=?').get(created.id).provider_id,provider(2));
  }finally{db.close();}
});

test('draft owner can persist photo order and removal before verification',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100),access=await issueDraftPhotoAccess(db,created.id,101),photoIds=[];
    for(let index=1;index<=3;index++){
      assert.ok(await recordDraftPhotoQuarantine(db,access.token,created.id,provider(index),102));
      const claimed=await claimDraftPhotoQuarantine(db,access.token,provider(index),103);
      const attached=await attachClaimedDraftPhoto(db,access.token,provider(index),claimed.claim,provider(index+10),104);photoIds.push(attached.photoId);
    }
    assert.equal(await reorderDraftPhotos(db,access.token,created.id,[photoIds[1],photoIds[0]],105),true);
    assert.deepEqual(db.sqlite.prepare('SELECT id FROM gear_photos WHERE listing_id=? ORDER BY position').all(created.id).map(row=>row.id),[photoIds[1],photoIds[0]]);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').all().some(row=>row.provider_id===provider(13)),true);
    assert.equal(await removeDraftPhoto(db,access.token,created.id,photoIds[1],106),true);
    assert.deepEqual(db.sqlite.prepare('SELECT id FROM gear_photos WHERE listing_id=? ORDER BY position').all(created.id).map(row=>row.id),[photoIds[0]]);
    assert.equal(db.sqlite.prepare('SELECT provider_id FROM gear_photo_deletions').all().some(row=>row.provider_id===provider(12)),true);
    assert.equal(await removeDraftPhoto(db,access.token,created.id,photoIds[1],107),true);
    assert.equal(await reorderDraftPhotos(db,access.token,created.id,[photoIds[0]],108),true);
    assert.equal(await removeDraftPhoto(db,'0'.repeat(64),created.id,photoIds[0],106),false);
  }finally{db.close();}
});

test('draft photo management routes are token-scoped and accept an authoritative empty order',async()=>{
  const db=openLocalDatabase();
  try{
    const created=await createDraft(db,sample,100),access=await issueDraftPhotoAccess(db,created.id,101);
    assert.ok(await recordDraftPhotoQuarantine(db,access.token,created.id,provider(1),102));
    const claimed=await claimDraftPhotoQuarantine(db,access.token,provider(1),103),attached=await attachClaimedDraftPhoto(db,access.token,provider(1),claimed.claim,provider(11),104);
    const reorder=createDraftPhotoReorderHandler({now:()=>105}),remove=createDraftPhotoRemoveHandler({now:()=>106}),env={GEAR_DB:db};
    let response=await reorder({request:request('/api/gear/drafts/photos/reorder',{listingId:created.id,draftToken:access.token,photoIds:[attached.photoId,attached.photoId]}),env});assert.equal(response.status,400);
    response=await reorder({request:request('/api/gear/drafts/photos/reorder',{listingId:created.id,draftToken:'0'.repeat(64),photoIds:[attached.photoId]}),env});assert.equal(response.status,401);
    response=await reorder({request:request('/api/gear/drafts/photos/reorder',{listingId:created.id,draftToken:access.token,photoIds:[attached.photoId]}),env});assert.equal(response.status,200);
    response=await remove({request:request('/api/gear/drafts/photos/remove',{listingId:created.id,draftToken:access.token,photoId:attached.photoId}),env});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    response=await remove({request:request('/api/gear/drafts/photos/remove',{listingId:created.id,draftToken:access.token,photoId:attached.photoId}),env});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    response=await reorder({request:request('/api/gear/drafts/photos/reorder',{listingId:created.id,draftToken:access.token,photoIds:[]}),env});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  }finally{db.close();}
});
