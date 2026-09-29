import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { localServer } from '../scripts/gear/local-server.mjs';
import { createDraft, readPublicListings } from '../lib/gear-storage.mjs';
import { issueLocalVerification, confirmVerification, TOKEN_TTL_MS } from '../lib/gear-verification.mjs';
import { LIMITS } from '../lib/gear-exchange.mjs';
const input={title:'Junior bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};

test('verification is submission-specific, hash-only, single use, with fixed expiry',async()=>{
 const db=openLocalDatabase();try{
  const a=await createDraft(db,input,100),b=await createDraft(db,{...input,title:'Another bag'},100);
  const receipt=await issueLocalVerification(db,a.id,200);
  const tokenRow=db.sqlite.prepare('SELECT * FROM gear_verification_tokens').get();
  assert.notEqual(tokenRow.token_hash,receipt.token);assert.equal(JSON.stringify(tokenRow).includes(receipt.token),false);
  assert.deepEqual(await confirmVerification(db,receipt.token,300),{verified:true,listingId:a.id});
  assert.deepEqual((await readPublicListings(db,301)).map(r=>r.id),[a.id]);
  assert.equal(db.sqlite.prepare('SELECT verified_at FROM gear_listings WHERE id=?').get(b.id).verified_at,null);
  const listing=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(a.id);
  assert.equal(listing.expires_at,300+LIMITS.durationDays*86400000);
  assert.deepEqual(await confirmVerification(db,receipt.token,400),{verified:false});
  assert.equal(db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(a.id).expires_at,listing.expires_at);
  assert.equal(await issueLocalVerification(db,a.id,500),null);
 }finally{db.close();}
});
test('reissue, expiry, changed email and removed records cannot be confirmed',async()=>{
 const db=openLocalDatabase();try{
  const {id}=await createDraft(db,input,100);
  const old=await issueLocalVerification(db,id,200),fresh=await issueLocalVerification(db,id,300);
  assert.deepEqual(await confirmVerification(db,old.token,400),{verified:false});
  assert.deepEqual(await confirmVerification(db,fresh.token,300+TOKEN_TTL_MS),{verified:false});
  assert.deepEqual(await confirmVerification(db,'bad',400),{verified:false});
  db.sqlite.exec("UPDATE gear_sellers SET email='changed@example.test'");
  assert.deepEqual(await confirmVerification(db,fresh.token,400),{verified:false});
  const last=await issueLocalVerification(db,id,500);db.sqlite.exec("UPDATE gear_listings SET status='removed'");
  assert.deepEqual(await confirmVerification(db,last.token,600),{verified:false});
 }finally{db.close();}
});
test('quota includes pending and competing confirmations cannot exceed ten',async()=>{
 const db=openLocalDatabase();try{
  const receipts=[];for(let i=0;i<LIMITS.activeListings+1;i++){const {id}=await createDraft(db,{...input,title:'Item '+i},100);receipts.push(await issueLocalVerification(db,id,200));}
  for(let i=0;i<9;i++)assert.equal((await confirmVerification(db,receipts[i].token,300)).verified,true);
  db.sqlite.exec("UPDATE gear_listings SET status='pending' WHERE status='available'");
  const results=await Promise.all(receipts.slice(9).map(r=>confirmVerification(db,r.token,400)));
  assert.equal(results.filter(r=>r.verified).length,1);assert.equal((await readPublicListings(db,400)).length,10);
  const blocked=receipts.slice(9)[results.findIndex(r=>!r.verified)];
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_verification_tokens WHERE consumed_at IS NULL').get().n,1);
  db.sqlite.exec('UPDATE gear_listings SET expires_at=500 WHERE verified_at IS NOT NULL');
  assert.equal((await confirmVerification(db,blocked.token,500)).verified,true);
 }finally{db.close();}
});
test('failed publication rolls back consumption and seller verification',async()=>{
 const db=openLocalDatabase();try{
  const {id}=await createDraft(db,input,100),receipt=await issueLocalVerification(db,id,200);
  db.sqlite.exec("CREATE TRIGGER fail_publish BEFORE UPDATE ON gear_listings BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(confirmVerification(db,receipt.token,300));
  assert.equal(db.sqlite.prepare('SELECT consumed_at FROM gear_verification_tokens').get().consumed_at,null);
  assert.equal(db.sqlite.prepare('SELECT verified_at FROM gear_sellers').get().verified_at,null);
 }finally{db.close();}
});
test('abandoned and repeated drafts are accepted; only one matching listing publishes',async()=>{
 const db=openLocalDatabase();try{
  const a=await createDraft(db,input,100);
  const b=await createDraft(db,{...input,title:' JUNIOR   BAG ',priceCents:5000,description:'Different'},200);
  const other=await createDraft(db,{...input,email:'other@example.test'},200);
  const ra=await issueLocalVerification(db,a.id,300),rb=await issueLocalVerification(db,b.id,300);
  const results=await Promise.all([confirmVerification(db,ra.token,400),confirmVerification(db,rb.token,400)]);
  assert.equal(results.filter(r=>r.verified).length,1);
  const ro=await issueLocalVerification(db,other.id,400);
  assert.equal((await confirmVerification(db,ro.token,500)).verified,true);
  assert.equal((await readPublicListings(db,500)).length,2);
 }finally{db.close();}
});
test('GET and unconfirmed POST cannot consume tokens; local sink and explicit POST can',async()=>{
 const db=openLocalDatabase(),server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const {id}=await(await post('/drafts',input)).json();
  assert.equal((await post('/drafts',input)).status,201);
  const {receipt}=await(await post('/drafts/'+id+'/verification',{})).json();
  assert.equal((await fetch(base+'/verification')).status,200);
  assert.equal((await post('/verification/confirm',{token:receipt.token})).status,400);
  assert.deepEqual(await readPublicListings(db),[]);
  assert.equal((await post('/verification/confirm',{token:receipt.token,confirm:true})).status,200);
  assert.equal((await post('/verification/confirm',{token:receipt.token,confirm:true})).status,400);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('expired matching listing can be reposted without reviving its token',async()=>{
 const db=openLocalDatabase();try{
  const {id}=await createDraft(db,input,100),receipt=await issueLocalVerification(db,id,200);
  await confirmVerification(db,receipt.token,300);
  const end=300+LIMITS.durationDays*86400000;
  const replacement=await createDraft(db,input,end);
  assert.notEqual(replacement.id,id);
  const newer=await issueLocalVerification(db,replacement.id,end);
  assert.equal((await confirmVerification(db,newer.token,end)).verified,true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'expired');
  assert.deepEqual(await confirmVerification(db,receipt.token,end),{verified:false});
 }finally{db.close();}
});

test('raw token updates exercise every guard and leave all records unchanged',async()=>{
 for(const scenario of ['replay','expired','early','removed','email','quota']){
  const db=openLocalDatabase();try{
   const {id}=await createDraft(db,input,100);await issueLocalVerification(db,id,200);
   let at=300;
   if(scenario==='replay')db.sqlite.prepare('UPDATE gear_verification_tokens SET consumed_at=250 WHERE listing_id=?').run(id);
   if(scenario==='expired')at=200+TOKEN_TTL_MS;
   if(scenario==='early')at=199;
   if(scenario==='removed')db.sqlite.exec("UPDATE gear_listings SET status='removed'");
   if(scenario==='email')db.sqlite.exec("UPDATE gear_sellers SET email='changed@example.test'");
   if(scenario==='quota')for(let i=0;i<LIMITS.activeListings;i++){
    const draft=await createDraft(db,{...input,title:'Quota '+i},100);
    db.sqlite.prepare("UPDATE gear_listings SET status='pending',verified_at=200,expires_at=99999 WHERE id=?").run(draft.id);
   }
   const snapshot=()=>JSON.stringify(['gear_listings','gear_sellers','gear_verification_tokens'].map(table=>db.sqlite.prepare('SELECT * FROM '+table).all()));
   const before=snapshot();assert.throws(()=>db.sqlite.prepare('UPDATE gear_verification_tokens SET consumed_at=? WHERE listing_id=?').run(at,id));assert.equal(snapshot(),before,scenario);
  }finally{db.close();}
 }
});
test('known trigger aborts are generic failures; unexpected database failures propagate',async()=>{
 for(const message of ['Active listing limit','Invalid verification transition','Unexpected failure']){
  const db=openLocalDatabase();try{
   const {id}=await createDraft(db,input,100),receipt=await issueLocalVerification(db,id,200);
   db.sqlite.exec("CREATE TRIGGER injected BEFORE UPDATE ON gear_verification_tokens BEGIN SELECT RAISE(ABORT,'"+message+"'); END;");
   if(message==='Unexpected failure')await assert.rejects(confirmVerification(db,receipt.token,300));
   else assert.deepEqual(await confirmVerification(db,receipt.token,300),{verified:false});
   assert.equal(db.sqlite.prepare('SELECT consumed_at FROM gear_verification_tokens').get().consumed_at,null);
  }finally{db.close();}
 }
});
test('reopen repairs rollback-era NULL keys and expires stale duplicates',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'gear-repair-')),path=join(dir,'db.sqlite');let db=openLocalDatabase(path);
 try{
  const a=await createDraft(db,input),b=await createDraft(db,input);
  db.sqlite.exec("UPDATE gear_listings SET duplicate_key=NULL,status='available',verified_at=1,expires_at=2");
  db.close();db=openLocalDatabase(path);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings WHERE duplicate_key IS NULL').get().n,0);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='expired'").get().n,2);
  db.sqlite.exec("UPDATE gear_listings SET duplicate_key=NULL,status='available',expires_at=9999999999999");
  const before=JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_listings ORDER BY id').all());
  db.close();db=null;assert.throws(()=>openLocalDatabase(path),/No backfill changes were saved/);
  const {DatabaseSync}=await import('node:sqlite');const check=new DatabaseSync(path,{readOnly:true});
  try{
   assert.equal(JSON.stringify(check.prepare('SELECT * FROM gear_listings ORDER BY id').all()),before);
   assert.equal(check.prepare("SELECT count(*) AS n FROM gear_listings WHERE duplicate_key IS NULL AND status='available'").get().n,2);
  }finally{check.close();}
 }finally{if(db)db.close();rmSync(dir,{recursive:true});}
});

test('migration 4 upgrades the old draft index and publication trigger',async()=>{
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'gear-v3-')),path=join(dir,'db.sqlite');let db=openLocalDatabase(path);
 try{
  const old=await createDraft(db,input);
  db.sqlite.exec("DROP INDEX gear_no_duplicates; CREATE UNIQUE INDEX gear_no_duplicates ON gear_listings(seller_id,duplicate_key) WHERE status IN ('unverified','available','pending'); DROP TRIGGER gear_verify_publish;");
  const migration=readFileSync(new URL('../migrations/gear/0002_verification.sql',import.meta.url),'utf8');
  db.sqlite.exec(migration.slice(migration.indexOf('CREATE TRIGGER gear_verify_publish')));
  db.sqlite.exec('DELETE FROM gear_local_migrations WHERE version=4');
  await assert.rejects(createDraft(db,input),/UNIQUE constraint/);
  db.close();db=openLocalDatabase(path);
  assert.equal(db.sqlite.prepare('SELECT version FROM gear_local_migrations WHERE version=4').get().version,4);
  const a=await createDraft(db,input),b=await createDraft(db,input);
  assert.notEqual(a.id,b.id);
  // Set the stale match AFTER reopen so only the upgraded publication trigger
  // can expire it (startup repair cannot make this test pass accidentally).
  db.sqlite.prepare("UPDATE gear_listings SET status='available',verified_at=100,expires_at=300 WHERE id=?").run(old.id);
  const receipt=await issueLocalVerification(db,a.id,200);
  assert.equal((await confirmVerification(db,receipt.token,300)).verified,true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(old.id).status,'expired');
  const second=await issueLocalVerification(db,b.id,300);
  assert.equal((await confirmVerification(db,second.token,301)).verified,false);
 }finally{if(db)db.close();rmSync(dir,{recursive:true});}
});

test('version-1 database upgrades with drafts preserved and keys backfilled',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'gear-v1-')),path=join(dir,'db.sqlite');
 const legacy=new DatabaseSync(path);
 try{
  legacy.exec(readFileSync(new URL('../migrations/gear/0001_drafts.sql',import.meta.url),'utf8'));
  legacy.exec("CREATE TABLE gear_local_migrations(version INTEGER PRIMARY KEY); INSERT INTO gear_local_migrations VALUES(1); INSERT INTO gear_sellers(id,email,created_at) VALUES('seller','sample@example.test',100)");
  legacy.exec("INSERT INTO gear_listings(id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,created_at) VALUES('legacy','seller','Sample','Junior bag','Worn zipper','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,100)");
 }finally{legacy.close();}
 try{
  const db=openLocalDatabase(path);try{
   const row=db.sqlite.prepare("SELECT * FROM gear_listings WHERE id='legacy'").get();
   assert.equal(row.status,'unverified');assert.ok(row.duplicate_key);
   assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_migrations').get().n,9);
   await createDraft(db,input);
   assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,2);
  }finally{db.close();}
 }finally{rmSync(dir,{recursive:true});}
});
