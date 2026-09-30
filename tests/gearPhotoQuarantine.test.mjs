import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../lib/gear-email-change.mjs';
import {recordHostedPhoto} from '../lib/gear-photo-storage.mjs';
import {
  GEAR_QUARANTINE_CLAIM_MS,GEAR_QUARANTINE_TTL_MS,attachClaimedPhoto,
  claimPhotoQuarantine,recordPhotoQuarantine,releasePhotoQuarantine,
} from '../lib/gear-photo-quarantine.mjs';

const input={title:'Quarantine bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'photo-q@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
const provider=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
async function publish(db,patch={},now=100){const draft=await createDraft(db,{...input,...patch},now);const receipt=await issueLocalVerification(db,draft.id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return draft.id;}
async function login(db,email=input.email,now=200){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}

test('migration 11 stores durable quarantine cleanup references without cascading them',async()=>{
  const db=openLocalDatabase();
  try{
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_migrations').get().n,13);
    const id=await publish(db),access=await login(db),row=await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),201);
    assert.deepEqual({...row},{providerId:provider(1),listingId:id,createdAt:201,expiresAt:201+GEAR_QUARANTINE_TTL_MS});
    assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_photo_quarantines').get()).includes(access.session),false);
    await assert.rejects(recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),202),/UNIQUE constraint/);
    assert.throws(()=>db.sqlite.prepare(`INSERT INTO gear_photo_quarantines
      (provider_id,listing_id,seller_id,created_at,expires_at,sanitized_provider_id,sanitized_at)
      VALUES(?,?,?,?,?,?,?)`).run(provider(9),id,provider(8),1,2,provider(7),2),/CHECK constraint/);
    assert.throws(()=>db.sqlite.prepare(`UPDATE gear_photo_quarantines SET claim_hash=?,claimed_at=? WHERE provider_id=?`)
      .run('g'.repeat(64),202,provider(1)),/CHECK constraint/);
    assert.throws(()=>db.sqlite.prepare(`UPDATE gear_photo_quarantines SET claimed_at=? WHERE provider_id=?`)
      .run(202,provider(1)),/CHECK constraint/);
    db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(id);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1)).n,1);
  }finally{db.close();}
});

test('record and claim require the current seller session, listing and bounded lease',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db),draft=(await createDraft(db,{...input,title:'Draft'})).id;
    assert.equal(await recordPhotoQuarantine(db,access.session,access.csrf,draft,provider(1),201),null);
    assert.equal(await recordPhotoQuarantine(db,access.session,'0'.repeat(64),id,provider(1),201),null);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),201);
    assert.equal(await claimPhotoQuarantine(db,access.session,'0'.repeat(64),provider(1),202),null);
    const first=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),202);assert.equal(first.listingId,id);assert.equal(first.claim.length,64);
    const stored=db.sqlite.prepare('SELECT claim_hash FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1));assert.notEqual(stored.claim_hash,first.claim);
    assert.equal(await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),202+GEAR_QUARANTINE_CLAIM_MS-1),null);
    assert.equal(await releasePhotoQuarantine(db,provider(1),'0'.repeat(64),203),false);
    assert.equal(await releasePhotoQuarantine(db,provider(1),first.claim,203),true);
    const second=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),204);assert.notEqual(second.claim,first.claim);
    const reclaimed=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),204+GEAR_QUARANTINE_CLAIM_MS);assert.ok(reclaimed);assert.notEqual(reclaimed.claim,second.claim);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(2),300);
    assert.equal(await claimPhotoQuarantine(db,access.session,access.csrf,provider(2),300+GEAR_QUARANTINE_TTL_MS),null);
    for(let index=3;index<=6;index++)assert.ok(await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(index),301));
    assert.equal(await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(7),301),null);
  }finally{db.close();}
});

test('claimed attachment rechecks authorization, records the lowest slot and consumes quarantine',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),201);
    const claimed=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),202);
    await assert.rejects(attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(1),203),/must differ/);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(1),'0'.repeat(64),provider(2),203),null);
    const result=await attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(2),203);
    assert.equal(result.ok,true);assert.equal(result.photo.listingId,id);assert.equal(result.photo.providerId,provider(2));assert.equal(result.photo.position,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT listing_id FROM gear_photo_deletions WHERE provider_id=?').get(provider(1)).listing_id,id);
    const replay=await attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(2),204);
    assert.deepEqual(replay,{ok:false,reason:'attached'});

    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(3),204);const revoked=await claimPhotoQuarantine(db,access.session,access.csrf,provider(3),205);
    db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=?').run(206);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(3),revoked.claim,provider(4),207),null);
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(3)).sanitized_provider_id,null);
  }finally{db.close();}
});

test('cross-seller credentials cannot record, claim or attach another seller quarantine',async()=>{
  const db=openLocalDatabase();
  try{
    const firstId=await publish(db),first=await login(db);
    await publish(db,{email:'other-quarantine@example.test',title:'Other bag'},110);
    const other=await login(db,'other-quarantine@example.test',210);
    assert.equal(await recordPhotoQuarantine(db,other.session,other.csrf,firstId,provider(1),211),null);
    await recordPhotoQuarantine(db,first.session,first.csrf,firstId,provider(1),211);
    assert.equal(await claimPhotoQuarantine(db,other.session,other.csrf,provider(1),212),null);
    const claimed=await claimPhotoQuarantine(db,first.session,first.csrf,provider(1),212);
    assert.equal(await attachClaimedPhoto(db,other.session,other.csrf,provider(1),claimed.claim,provider(2),213),null);
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1)).sanitized_provider_id,null);
  }finally{db.close();}
});

test('attachment honors post-expiry claims, exact lease expiry, stale claims and listing state changes',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),1000);
    const nearExpiry=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),1000+GEAR_QUARANTINE_TTL_MS-1);
    assert.equal((await attachClaimedPhoto(db,access.session,access.csrf,provider(1),nearExpiry.claim,provider(2),1000+GEAR_QUARANTINE_TTL_MS+1000)).ok,true);

    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(3),2000);
    const oldClaim=await claimPhotoQuarantine(db,access.session,access.csrf,provider(3),2001);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(3),oldClaim.claim,provider(4),2001+GEAR_QUARANTINE_CLAIM_MS),null);
    const newClaim=await claimPhotoQuarantine(db,access.session,access.csrf,provider(3),2001+GEAR_QUARANTINE_CLAIM_MS);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(3),oldClaim.claim,provider(4),2002+GEAR_QUARANTINE_CLAIM_MS),null);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(5),3000);
    const boundary=await claimPhotoQuarantine(db,access.session,access.csrf,provider(5),3001);
    assert.equal((await attachClaimedPhoto(db,access.session,access.csrf,provider(5),boundary.claim,provider(6),3001+GEAR_QUARANTINE_CLAIM_MS-1)).ok,true);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(3),newClaim.claim,provider(4),2003+GEAR_QUARANTINE_CLAIM_MS),null);
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(3)).sanitized_provider_id,null);
  }finally{db.close();}
});

test('attachment rolls back the sanitized reference when the photo insert fails',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),201);
    const claimed=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),202);
    db.sqlite.exec("CREATE TRIGGER fail_quarantine_photo BEFORE INSERT ON gear_photos BEGIN SELECT RAISE(ABORT,'injected photo failure'); END");
    await assert.rejects(attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(2),203),/injected photo failure/);
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1)).sanitized_provider_id,null);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos').get().n,0);
    db.sqlite.exec('DROP TRIGGER fail_quarantine_photo');
    db.sqlite.exec("CREATE TRIGGER fail_quarantine_outbox BEFORE INSERT ON gear_photo_deletions BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END");
    await assert.rejects(attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(2),204),/injected outbox failure/);
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1)).sanitized_provider_id,null);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos').get().n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_deletions').get().n,0);
  }finally{db.close();}
});

test('email ownership transfer invalidates an in-flight quarantine without discarding its cleanup reference',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(1),201);
    const claimed=await claimPhotoQuarantine(db,access.session,access.csrf,provider(1),202);
    const transfer=await issueLocalEmailChange(db,access.session,access.csrf,'new-quarantine@example.test',203);
    assert.equal(await confirmEmailChange(db,transfer.token,204),true);
    assert.equal(await attachClaimedPhoto(db,access.session,access.csrf,provider(1),claimed.claim,provider(2),205),null);
    const row=db.sqlite.prepare('SELECT seller_id,sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(1));
    assert.equal(row.sanitized_provider_id,null);
    assert.notEqual(row.seller_id,db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(id).seller_id);
  }finally{db.close();}
});

test('photo-slot conflict retains the sanitized cleanup reference and cannot be released',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await publish(db),access=await login(db);
    await recordPhotoQuarantine(db,access.session,access.csrf,id,provider(7),210);
    for(let index=1;index<=6;index++)await recordHostedPhoto(db,id,provider(index),200+index);
    const claim=await claimPhotoQuarantine(db,access.session,access.csrf,provider(7),211);
    assert.deepEqual(await attachClaimedPhoto(db,access.session,access.csrf,provider(7),claim.claim,provider(8),212),{ok:false,reason:'conflict',cleanupProviderIds:[provider(8)]});
    assert.equal(db.sqlite.prepare('SELECT sanitized_provider_id FROM gear_photo_quarantines WHERE provider_id=?').get(provider(7)).sanitized_provider_id,provider(8));
    assert.equal(await releasePhotoQuarantine(db,provider(7),claim.claim,213),false);
    db.sqlite.prepare('DELETE FROM gear_photos WHERE listing_id=? AND position=2').run(id);
    assert.deepEqual(await attachClaimedPhoto(db,access.session,access.csrf,provider(7),claim.claim,provider(8),214),{ok:false,reason:'conflict',cleanupProviderIds:[provider(8)]});
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photos WHERE provider_id=?').get(provider(8)).n,0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_photo_quarantines WHERE provider_id=?').get(provider(7)).n,1);
  }finally{db.close();}
});
