import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeSellerPhotoUpload,GEAR_PHOTO_UPLOAD_WINDOW_MS,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY} from '../lib/gear-photo-rate-limit.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {confirmVerification,issueLocalVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';

const sample={title:'Rate-limited bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'rate@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...sample,...patch},now),receipt=await issueLocalVerification(db,draft.id,now);await confirmVerification(db,receipt.token,now);return draft.id;}
async function login(db,email=sample.email,now=150){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}

test('seller photo upload budget is atomic across listings and resets at the UTC-day boundary',async()=>{
  const db=openLocalDatabase();try{
    const now=2*GEAR_PHOTO_UPLOAD_WINDOW_MS+1234,id=await publish(db),second=await publish(db,{title:'Second listing'}),access=await login(db,sample.email,now-100);
    const results=await Promise.all(Array.from({length:GEAR_SELLER_PHOTO_UPLOADS_PER_DAY+5},()=>consumeSellerPhotoUpload(db,access.session,access.csrf,id,now)));
    assert.equal(results.filter(result=>result.allowed).length,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY);
    assert.equal(results.filter(result=>!result.allowed).length,5);
    assert.equal(db.sqlite.prepare('SELECT attempts FROM gear_photo_upload_limits').get().attempts,GEAR_SELLER_PHOTO_UPLOADS_PER_DAY);
    const blocked=await consumeSellerPhotoUpload(db,access.session,access.csrf,second,now);assert.equal(blocked.allowed,false);assert.equal(blocked.retryAfterSeconds,Math.ceil((3*GEAR_PHOTO_UPLOAD_WINDOW_MS-now)/1000));
    assert.equal(blocked.reason,'limited');
    assert.equal((await consumeSellerPhotoUpload(db,access.session,access.csrf,second,3*GEAR_PHOTO_UPLOAD_WINDOW_MS-1)).retryAfterSeconds,1);
    const reset=await consumeSellerPhotoUpload(db,access.session,access.csrf,second,3*GEAR_PHOTO_UPLOAD_WINDOW_MS);assert.deepEqual(reset,{allowed:true,remaining:GEAR_SELLER_PHOTO_UPLOADS_PER_DAY-1,resetAt:4*GEAR_PHOTO_UPLOAD_WINDOW_MS});
  }finally{db.close();}
});

test('seller photo upload budget rechecks credentials, ownership and manageable state without recording rejected attempts',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),access=await login(db),foreignId=await publish(db,{email:'foreign-rate@example.test',title:'Foreign'}),foreign=await login(db,'foreign-rate@example.test');
    assert.equal((await consumeSellerPhotoUpload(db,access.session,'0'.repeat(64),id,200)).allowed,false);
    assert.equal((await consumeSellerPhotoUpload(db,foreign.session,foreign.csrf,id,200)).allowed,false);
    assert.equal((await consumeSellerPhotoUpload(db,access.session,access.csrf,foreignId,200)).allowed,false);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
    assert.deepEqual(await consumeSellerPhotoUpload(db,access.session,access.csrf,id,200),{allowed:false,reason:'unavailable'});
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_upload_limits').get().n,0);
  }finally{db.close();}
});

test('photo upload budget schema enforces aligned bounded retention and cascades with its seller',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),sellerId=db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(id).seller_id;
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_photo_upload_limits VALUES(?,?,?,?)').run(sellerId,1,1,1+GEAR_PHOTO_UPLOAD_WINDOW_MS),/CHECK constraint/);
    db.sqlite.prepare('INSERT INTO gear_photo_upload_limits VALUES(?,?,?,?)').run(sellerId,0,1,GEAR_PHOTO_UPLOAD_WINDOW_MS);
    db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(id);db.sqlite.prepare('DELETE FROM gear_sellers WHERE id=?').run(sellerId);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_upload_limits').get().n,0);
  }finally{db.close();}
});
