import test from 'node:test';
import assert from 'node:assert/strict';
import {createGearPhotoRemoveHandler} from '../functions/api/gear/management/photos/remove.js';
import {createGearPhotoReorderHandler} from '../functions/api/gear/management/photos/reorder.js';
import {removeManagedPhoto,reorderManagedPhotos} from '../lib/gear-photo-management.mjs';
import {recordHostedPhoto} from '../lib/gear-photo-storage.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,issuePostVerificationManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const ORIGIN='https://postandin.com';
const provider=index=>`00000000-0000-4000-8002-${String(index).padStart(12,'0')}`;
const sample={title:'Managed photo bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'photo-manage@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...sample,...patch},now),receipt=await issueLocalVerification(db,draft.id,now);await confirmVerification(db,receipt.token,now);return draft.id;}
async function login(db,email=sample.email,now=150){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
async function photos(db,id,count=3,start=1){const rows=[];for(let index=start;index<start+count;index++)rows.push(await recordHostedPhoto(db,id,provider(index),100+index));return rows;}
const stored=(db,id)=>db.sqlite.prepare('SELECT id,provider_id AS providerId,position,created_at AS createdAt FROM gear_photos WHERE listing_id=? ORDER BY position,id').all(id).map(row=>({...row}));
function request(path,body,access,options={}){
  const headers={Origin:ORIGIN,'Content-Type':'application/json',Cookie:`__Host-gear_session=${access?.session??'a'.repeat(64)}`,'X-Gear-CSRF':access?.csrf??'b'.repeat(64),...options.headers};
  return new Request(options.url??ORIGIN+path,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
}

test('seller photo reorder and removal are atomic, ownership checked and durably queue deletion',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),rows=await photos(db,id),foreignId=await publish(db,{email:'foreign-photo@example.test',title:'Foreign'}),foreign=await login(db,'foreign-photo@example.test');
    assert.equal(await reorderManagedPhotos(db,foreign.session,foreign.csrf,id,rows.map(row=>row.id).reverse(),200),false);
    assert.equal(await reorderManagedPhotos(db,access.session,'0'.repeat(64),id,rows.map(row=>row.id).reverse(),200),false);
    assert.equal(await reorderManagedPhotos(db,access.session,access.csrf,id,[rows[0].id,rows[0].id],200),false);
    assert.equal(await reorderManagedPhotos(db,access.session,access.csrf,id,rows.map(row=>row.id).reverse(),200),true);
    assert.deepEqual(stored(db,id).map(row=>row.id),rows.map(row=>row.id).reverse());
    assert.deepEqual(stored(db,id).map(row=>row.position),[0,1,2]);
    assert.equal(await removeManagedPhoto(db,foreign.session,foreign.csrf,id,rows[1].id,201),false);
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,foreignId,rows[1].id,201),false);
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,id,rows[1].id,201),true);
    assert.deepEqual(stored(db,id).map(row=>row.id),[rows[2].id,rows[0].id]);assert.deepEqual(stored(db,id).map(row=>row.position),[0,1]);
    assert.deepEqual({...db.sqlite.prepare('SELECT provider_id,listing_id,queued_at FROM gear_photo_deletions').get()},{provider_id:rows[1].providerId,listing_id:id,queued_at:201});
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,id,rows[1].id,202),false);
  }finally{db.close();}
});

test('durable listing sessions cannot mutate another listing from the same seller',async()=>{
  const db=openLocalDatabase();try{
    const first=await publish(db),second=await publish(db,{title:'Second scoped photo listing'},101),firstRows=await photos(db,first,1),secondRows=await photos(db,second,1,2),link=await issuePostVerificationManagementLink(db,first,100),access=await redeemManagementLink(db,link.token,200);
    assert.equal(await reorderManagedPhotos(db,access.session,access.csrf,second,secondRows.map(row=>row.id).reverse(),201),false);
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,second,secondRows[0].id,201),false);
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,first,firstRows[0].id,201),true);
  }finally{db.close();}
});

test('photo mutation loses stale races without removing, resurrecting or leaking remote objects',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),rows=await photos(db,id,2);let raced=false;
    const wrapper={prepare:(...args)=>db.prepare(...args),batch:async statements=>{if(!raced){raced=true;await recordHostedPhoto(db,id,provider(3),190);}return db.batch(statements);}};
    assert.equal(await removeManagedPhoto(wrapper,access.session,access.csrf,id,rows[0].id,200),false);
    assert.deepEqual(stored(db,id).map(row=>row.providerId),[provider(1),provider(2),provider(3)]);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,0);
    const before=JSON.stringify(stored(db,id));
    db.sqlite.exec("CREATE TRIGGER fail_managed_photo_outbox BEFORE INSERT ON gear_photo_deletions BEGIN SELECT RAISE(ABORT,'injected photo queue failure'); END");
    await assert.rejects(removeManagedPhoto(db,access.session,access.csrf,id,rows[0].id,201),/injected photo queue failure/);
    assert.equal(JSON.stringify(stored(db,id)),before);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,0);
  }finally{db.close();}
});

test('photo mutation cannot resurrect a stale snapshot after concurrent removal empties the listing',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),rows=await photos(db,id,2);let raced=false;
    const wrapper={prepare:(...args)=>db.prepare(...args),batch:async statements=>{
      if(!raced){raced=true;assert.equal(await removeManagedPhoto(db,access.session,access.csrf,id,rows[0].id,190),true);assert.equal(await removeManagedPhoto(db,access.session,access.csrf,id,rows[1].id,191),true);}
      return db.batch(statements);
    }};
    assert.equal(await removeManagedPhoto(wrapper,access.session,access.csrf,id,rows[0].id,200),false);
    assert.deepEqual(stored(db,id),[]);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE listing_id=?').get(id).n,2);

    const reorderId=await publish(db,{title:'Stale reorder'}),reorderRows=await photos(db,reorderId,2,4);raced=false;
    const reorderWrapper={prepare:(...args)=>db.prepare(...args),batch:async statements=>{
      if(!raced){raced=true;assert.equal(await removeManagedPhoto(db,access.session,access.csrf,reorderId,reorderRows[0].id,192),true);assert.equal(await removeManagedPhoto(db,access.session,access.csrf,reorderId,reorderRows[1].id,193),true);}
      return db.batch(statements);
    }};
    assert.equal(await reorderManagedPhotos(reorderWrapper,access.session,access.csrf,reorderId,reorderRows.map(row=>row.id).reverse(),200),false);
    assert.deepEqual(stored(db,reorderId),[]);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions WHERE listing_id=?').get(reorderId).n,2);
  }finally{db.close();}
});

test('photo mutation rejects removed listings, revoked sessions and stale complete orders',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),rows=await photos(db,id,2);
    assert.equal(await reorderManagedPhotos(db,access.session,access.csrf,id,[rows[0].id],200),false);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
    assert.equal(await removeManagedPhoto(db,access.session,access.csrf,id,rows[0].id,201),false);
    db.sqlite.prepare("UPDATE gear_listings SET status='available'").run();db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=201').run();
    assert.equal(await reorderManagedPhotos(db,access.session,access.csrf,id,rows.map(row=>row.id),202),false);
  }finally{db.close();}
});

test('Pages photo management routes enforce transport, auth and exact bounded bodies',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),rows=await photos(db,id,2),remove=createGearPhotoRemoveHandler({now:()=>200}),reorder=createGearPhotoReorderHandler({now:()=>200}),env={GEAR_DB:db};
    let response=await reorder({request:request('/api/gear/management/photos/reorder',{listingId:id,photoIds:rows.map(row=>row.id).reverse()},access),env});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    response=await remove({request:request('/api/gear/management/photos/remove',{listingId:id,photoId:rows[0].id},access),env});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
    for(const handler of [remove,reorder]){
      response=await handler({request:request('/api/gear/management/photos/change',{},access,{headers:{Origin:'https://foreign.test'}}),env});assert.equal(response.status,403);
      response=await handler({request:request('/api/gear/management/photos/change',{},access,{headers:{'X-Gear-CSRF':''}}),env});assert.equal(response.status,403);
      response=await handler({request:request('/api/gear/management/photos/change','{',access),env});assert.equal(response.status,400);
      response=await handler({request:request('/api/gear/management/photos/change',{},access),env:{}});assert.equal(response.status,400);
    }
  }finally{db.close();}
});

test('photo management route failures are generic and adapters receive only authenticated fields',async()=>{
  const db={};let received;
  const access={session:'a'.repeat(64),csrf:'b'.repeat(64)},listingId='00000000-0000-4000-8000-000000000010',photoId='00000000-0000-4000-8000-000000000011';
  let handler=createGearPhotoRemoveHandler({access:async()=>true,remove:async(...args)=>{received=args;return true;},now:()=>200});
  let response=await handler({request:request('/api/gear/management/photos/remove',{listingId,photoId},access),env:{GEAR_DB:db}});assert.equal(response.status,200);assert.deepEqual(received,[db,access.session,access.csrf,listingId,photoId,200]);
  handler=createGearPhotoReorderHandler({access:async()=>true,reorder:async()=>{throw new Error('private database detail');},now:()=>200});
  response=await handler({request:request('/api/gear/management/photos/reorder',{listingId,photoIds:[photoId]},access),env:{GEAR_DB:db}});assert.equal(response.status,500);assert.equal((await response.text()).includes('private'),false);
  handler=createGearPhotoRemoveHandler({access:async()=>true,remove:async()=>true,now:()=>200});
  response=await handler({request:request('/api/gear/management/photos/remove',{listingId,photoId},access),env:{}});assert.equal(response.status,503);
});
