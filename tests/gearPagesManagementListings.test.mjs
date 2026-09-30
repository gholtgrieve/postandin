import test from 'node:test';
import assert from 'node:assert/strict';
import * as listingRoute from '../functions/api/gear/management/listing.js';
import * as listingsRoute from '../functions/api/gear/management/listings.js';
import {createManagementListingHandler} from '../functions/api/gear/management/listing.js';
import {createManagementListingsHandler} from '../functions/api/gear/management/listings.js';
import {changeSellerDeletion} from '../lib/gear-seller-deletion.mjs';
import {issueLocalManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {recordHostedPhoto} from '../lib/gear-photo-storage.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification} from '../lib/gear-verification.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com',SESSION='a'.repeat(64),CSRF='b'.repeat(64);
const delivery={GEAR_IMAGES_ACCOUNT_HASH:'account_hash_1234567890',GEAR_IMAGES_PUBLIC_VARIANT:'gear-public',GEAR_IMAGES_SIGNING_KEY:'signing-key-for-tests'};
const sample={title:'Managed production bag',description:'Worn zipper.',city:'Seattle',fit:'Junior bag',sellerName:'Sample',email:'managed-pages@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...sample,...patch},now),receipt=await issueLocalVerification(db,draft.id,now);await confirmVerification(db,receipt.token,now);return draft.id;}
async function login(db,email=sample.email,now=150){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
function request(path,body,access={},headers={}){return new Request(ORIGIN+path,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Cookie:`__Host-gear_session=${access?.session??SESSION}`,'X-Gear-CSRF':access?.csrf??CSRF,...headers},body:typeof body==='string'?body:JSON.stringify(body)});}
const context=(request,db,env={})=>({request,env:{GEAR_DB:db,...env}});

test('production management listings return only current owner rows with signed photo projection and deletion recovery metadata',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),deletedId=await publish(db,{title:'Deleted bag'}),ownerRemovedId=await publish(db,{title:'Owner-removed bag'}),foreignId=await publish(db,{title:'Foreign bag',email:'foreign-managed@example.test'}),access=await login(db);
    const photo=await recordHostedPhoto(db,id,'00000000-0000-4000-8000-000000000090',180);assert.ok(photo);
    await changeSellerDeletion(db,access.session,access.csrf,{id:deletedId,action:'delete'},190);
    db.sqlite.prepare('UPDATE gear_deletions SET purge_at=199 WHERE listing_id=?').run(deletedId);db.sqlite.prepare('UPDATE gear_deletion_ledger SET purge_at=199 WHERE listing_id=?').run(deletedId);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(ownerRemovedId);
    const response=await createManagementListingsHandler({now:()=>200})(context(request('/api/gear/management/listings',{},access),db,delivery));
    assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.deleted.map(row=>row.id),[deletedId]);assert.equal(body.deleted[0].title,'Deleted bag');assert.equal(body.deleted[0].purgeAt,199);
    assert.deepEqual(new Set(body.listings.map(row=>row.id)),new Set([id,ownerRemovedId]));assert.equal(body.listings.find(row=>row.id===ownerRemovedId).status,'removed');
    const projected=body.listings.find(row=>row.id===id);assert.equal(projected.photos.length,1);assert.equal(projected.photos[0].id,photo.id);
    assert.match(projected.photos[0].url,/^https:\/\/imagedelivery\.net\//);assert.equal(Object.hasOwn(projected.photos[0],'providerId'),false);
    assert.equal(JSON.stringify(body).includes(sample.email),false);assert.equal(JSON.stringify(body).includes(foreignId),false);
  }finally{db.close();}
});

test('production management listing route edits and changes state through the live session and CSRF boundary',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),foreign=await publish(db,{title:'Foreign',email:'foreign-write@example.test'}),access=await login(db),handler=createManagementListingHandler({now:()=>200});
    const description='界'.repeat(3000);
    let response=await handler(context(request('/api/gear/management/listing',{id,action:'edit',listing:{...sample,title:'Updated production bag',description}},access),db));
    assert.equal(response.status,200);assert.deepEqual({...db.sqlite.prepare('SELECT title,description FROM gear_listings WHERE id=?').get(id)},{title:'Updated production bag',description});
    response=await handler(context(request('/api/gear/management/listing',{id,action:'pending'},access),db));assert.equal(response.status,200);assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'pending');
    response=await handler(context(request('/api/gear/management/listing',{id:foreign,action:'close'},access),db));assert.equal(response.status,409);
    response=await handler(context(request('/api/gear/management/listing',{id,action:'edit',listing:{...sample,title:''}},access),db));assert.equal(response.status,400);assert.ok((await response.json()).fields.title);
    response=await handler(context(request('/api/gear/management/listing',{id,action:'close'},access,{'X-Gear-CSRF':'0'.repeat(64)}),db));assert.equal(response.status,403);assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'pending');
    response=await handler(context(request('/api/gear/management/listing',{id,action:'close'},access),db));assert.equal(response.status,200);
    for(let index=0;index<10;index++)await publish(db,{title:`Quota listing ${index}`},210+index);
    response=await handler(context(request('/api/gear/management/listing',{id,action:'relist'},access),db));assert.equal(response.status,409);
  }finally{db.close();}
});

test('management listing routes reject malformed transport, stale access, missing configuration and private failures',async()=>{
  let calls=0;const read=createManagementListingsHandler({read:async()=>{calls++;return {listings:[],deleted:[]};}}),write=createManagementListingHandler({recover:async()=>{calls++;return {csrf:CSRF};},change:async()=>{calls++;return true;}}),db={};
  assert.equal((await read(context(request('/api/gear/management/listings',{},null,{Origin:'https://foreign.test'}),db,delivery))).status,403);
  assert.equal((await read(context(request('/api/gear/management/listings',{extra:true}),db,delivery))).status,400);
  assert.equal((await read({request:request('/api/gear/management/listings',{}),env:{GEAR_DB:db}})).status,503);
  assert.equal((await read({request:request('/api/gear/management/listings',{}),env:{GEAR_DB:db,GEAR_IMAGES_ACCOUNT_HASH:delivery.GEAR_IMAGES_ACCOUNT_HASH}})).status,503);
  assert.equal((await write(context(request('/api/gear/management/listing',{id:'bad',action:'close'}),db))).status,400);
  assert.equal((await write(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close',extra:true}),db))).status,400);
  assert.equal((await write(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close'},null,{'X-Gear-CSRF':''}),db))).status,403);
  assert.equal((await write(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close'},null,{Cookie:`__Host-gear_session=${SESSION}; __Host-gear_session=${SESSION}`}),db))).status,401);
  assert.equal((await write(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'edit',listing:{description:'x'.repeat(25000)}}),db))).status,413);
  assert.equal(calls,0);
  let response=await createManagementListingsHandler({read:async()=>null})(context(request('/api/gear/management/listings',{}),db,delivery));assert.equal(response.status,401);
  response=await createManagementListingHandler({recover:async()=>null})(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close'}),db));assert.equal(response.status,401);
  response=await createManagementListingsHandler({read:async()=>{throw new Error('private read');}})(context(request('/api/gear/management/listings',{}),db,delivery));assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
  response=await createManagementListingsHandler({read:async()=>({listings:[{id:'00000000-0000-4000-8000-000000000001',photoRefs:[{id:'bad',providerId:'bad'}]}],deleted:[]})})(context(request('/api/gear/management/listings',{}),db,delivery));assert.equal(response.status,500);
  response=await createManagementListingHandler({recover:async()=>({csrf:CSRF}),change:async()=>{throw new Error('private write');}})(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close'}),db));assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
  let recovers=0;
  response=await createManagementListingHandler({recover:async()=>++recovers===1?{csrf:CSRF}:null,change:async()=>false})(context(request('/api/gear/management/listing',{id:'00000000-0000-4000-8000-000000000001',action:'close'}),db));assert.equal(response.status,401);
});

test('management listing Pages modules expose only POST handlers',()=>{
  for(const route of [listingRoute,listingsRoute])assert.deepEqual(Object.keys(route).filter(key=>key.startsWith('onRequest')),['onRequestPost']);
});
