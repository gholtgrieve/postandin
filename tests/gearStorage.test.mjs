import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { safeDatabasePath } from '../scripts/gear/local-path.mjs';
import { request } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, linkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { localServer } from '../scripts/gear/local-server.mjs';
import { LIMITS } from '../lib/gear-exchange.mjs';
import { validateDraft, DraftValidationError } from '../lib/gear-validation.mjs';
import { createDraft, readLocalDraft, readPublicListings } from '../lib/gear-storage.mjs';
const input={title:'Club bag',description:'Worn zipper, repaired seam.',city:'Seattle',fit:'Junior bag',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4050,clubs:['Other','Kent Valley'],otherClub:'Example Club'};

test('validation rejects malformed fields and privilege injection cannot publish',()=>{
  for(const patch of [{priceCents:NaN},{priceCents:0},{priceCents:1.5},{priceCents:'40'},{email:'a@b.test\r\nBcc:x@y.test'},{adult:'true'},{clubs:['Invented']},{otherClub:''},{category:'bad'},{description:' '},{title:'x'.repeat(101)},{type:'wanted'}])assert.throws(()=>validateDraft({...input,...patch}),DraftValidationError);
  for(const value of [null,[],5])assert.throws(()=>validateDraft(value),DraftValidationError);
  const clean=validateDraft({...input,status:'available',sellerId:'owner',verified_at:1});
  assert.equal(clean.status,undefined);assert.equal(clean.sellerId,undefined);
  assert.equal(validateDraft({...input,type:'free',trade:'hidden',priceCents:20}).priceCents,0);
  assert.equal(validateDraft({...input,type:'free',trade:'hidden'}).trade,'');
  assert.throws(()=>validateDraft({...input,type:'trade'}),DraftValidationError);
});

test('draft persists across reopen with clubs, but never appears publicly',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-test-')),path=join(dir,'db.sqlite');let db=openLocalDatabase(path);
  try {const {id}=await createDraft(db,{...input,status:'available',verified_at:1});db.close();db=openLocalDatabase(path);
    const draft=await readLocalDraft(db,id);assert.equal(draft.status,'unverified');assert.equal(draft.price_cents,4050);assert.equal(draft.email,input.email);assert.deepEqual(draft.clubs,['Kent Valley','Other']);assert.deepEqual(await readPublicListings(db),[]);
    assert.equal(await readLocalDraft(db,"' OR 1=1 --"),null);
  }finally{db.close();rmSync(dir,{recursive:true});}
});

test('batch rolls back all records when a club insert fails',async()=>{
  const db=openLocalDatabase();try{
    db.sqlite.exec("CREATE TRIGGER fail_club BEFORE INSERT ON gear_listing_clubs BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    await assert.rejects(createDraft(db,input));
    for(const table of ['gear_sellers','gear_listings','gear_listing_clubs'])assert.equal(db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  }finally{db.close();}
});

test('public reads require verified seller/listing, visible status and future expiry; no private fields',async()=>{
  const db=openLocalDatabase();try{
    const {id}=await createDraft(db,input,100);
    db.sqlite.prepare("UPDATE gear_listings SET status='available',verified_at=101,expires_at=200 WHERE id=?").run(id);
    assert.deepEqual(await readPublicListings(db,150),[]);
    db.sqlite.exec('UPDATE gear_sellers SET verified_at=101');
    for(const status of ['available','pending']){
      db.sqlite.prepare('UPDATE gear_listings SET status=?').run(status);
      const rows=await readPublicListings(db,150);assert.equal(rows.length,1);assert.equal(rows[0].priceCents,4050);assert.deepEqual(rows[0].clubs,['Kent Valley','Other']);
      for(const key of ['email','seller_id','verified_at'])assert.equal(Object.hasOwn(rows[0],key),false);
    }
    assert.deepEqual(await readPublicListings(db,200),[]);
    for(const status of ['unverified','closed','expired','removed']){db.sqlite.prepare('UPDATE gear_listings SET status=?').run(status);assert.deepEqual(await readPublicListings(db,150),[]);}
  }finally{db.close();}
});

test('HTTP local boundary, invalid JSON, validation, missing and generic storage failure',async()=>{
  const db=openLocalDatabase(),server=localServer(db);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=body=>fetch(base+'/drafts',{method:'POST',headers:{'Content-Type':'application/json'},body});
  try{
    for(const headers of [{Origin:'https://example.test'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(base+'/listings',{headers})).status,403);
    assert.equal((await fetch(base+'/drafts',{method:'POST',body:'{}'})).status,415);
    assert.equal((await fetch(base+'/listings',{method:'PUT'})).status,404);
    const chunked=await new Promise((resolve,reject)=>{const req=request(base+'/drafts',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.write('x'.repeat(20000));req.write('x'.repeat(20000));req.end();});
    assert.equal(chunked,413);
    assert.equal(await new Promise((resolve,reject)=>{const req=request(base+'/listings',{headers:{Host:'example.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();}),403);
    assert.equal((await post('{')).status,400);assert.equal((await post('{}')).status,400);
    assert.equal((await post('x'.repeat(33000))).status,413);
    const created=await post(JSON.stringify(input));assert.equal(created.status,201);const {id}=await created.json();
    const response=await fetch(base+'/drafts/'+id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await (await fetch(base+'/listings')).json(),{listings:[]});
    assert.equal((await fetch(base+'/drafts/00000000-0000-0000-0000-000000000000')).status,404);
    db.sqlite.exec('DROP TABLE gear_listing_clubs');
    const original=console.error;console.error=()=>{};
    try{const failed=await post(JSON.stringify(input));assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'Unable to process the request.'});}finally{console.error=original;}
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

test('database rejects invalid publication and prices; repeated email grants no verification',async()=>{
  const db=openLocalDatabase();try{
    await createDraft(db,input);await createDraft(db,{...input,email:'SAMPLE@EXAMPLE.TEST'});
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_sellers').get().n,1);
    assert.equal(db.sqlite.prepare('SELECT verified_at FROM gear_sellers').get().verified_at,null);
    assert.throws(()=>db.sqlite.exec("UPDATE gear_listings SET status='available'"));
    assert.throws(()=>db.sqlite.exec('UPDATE gear_listings SET price_cents=NULL'));
    assert.throws(()=>db.sqlite.exec('UPDATE gear_listings SET price_cents=-1'));
    assert.deepEqual(await readPublicListings(db),[]);
  }finally{db.close();}
});

test('database paths reject checkout, symlink and case aliases',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-path-'));const root=join(dir,'Checkout');mkdirSync(root);symlinkSync(root,join(dir,'alias'));
  try{
    assert.throws(()=>safeDatabasePath('relative.sqlite',root));
    assert.throws(()=>safeDatabasePath(join(root,'local.sqlite'),root));
    assert.throws(()=>safeDatabasePath(join(dir,'alias','local.sqlite'),root));
    if(process.platform==='darwin')assert.throws(()=>safeDatabasePath(join(dir,'checkout','local.sqlite'),root));
    assert.equal(safeDatabasePath(join(dir,'safe.sqlite'),root).endsWith('/safe.sqlite'),true);
  }finally{rmSync(dir,{recursive:true});}
});
test('an unrelated database remains byte-for-byte unchanged',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-existing-'));const path=join(dir,'other.sqlite');
  const other=new DatabaseSync(path);other.exec('CREATE TABLE unrelated (id INTEGER)');other.close();
  try{const before=readFileSync(path);assert.throws(()=>openLocalDatabase(path),/non-Gear/);assert.deepEqual(readFileSync(path),before);}finally{rmSync(dir,{recursive:true});}
});
test('validation boundary cases and normalized optional fields',()=>{
  for(const priceCents of [100,500000])assert.equal(validateDraft({...input,priceCents}).priceCents,priceCents);
  for(const patch of [{priceCents:99},{priceCents:500001},{email:'a@.b.c'},{email:'a@b..c'},{type:'trade',trade:' '},{city:'Sea\nttle'}])assert.throws(()=>validateDraft({...input,...patch}),DraftValidationError);
  const d=validateDraft({...input,clubs:['Kent Valley','Kent Valley'],otherClub:'stale',trade:'stale',description:'First line\nSecond line'});
  assert.deepEqual(d.clubs,['Kent Valley']);assert.equal(d.otherClub,'');assert.equal(d.trade,'');
});

test('dangling symlinks and hard-linked databases are rejected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-links-'));const root=join(dir,'checkout');mkdirSync(root);
  try{
    const dangling=join(dir,'dangling.sqlite');symlinkSync(join(root,'new.data'),dangling);
    assert.throws(()=>safeDatabasePath(dangling,root),/symbolic link/);
    const inside=join(root,'existing.data');writeFileSync(inside,'sample');const outside=join(dir,'linked.sqlite');linkSync(inside,outside);
    assert.throws(()=>safeDatabasePath(outside,root),/hard links/);
    const text=join(dir,'not-sqlite');writeFileSync(text,'not a database');
    assert.throws(()=>openLocalDatabase(text));assert.equal(readFileSync(text,'utf8'),'not a database');
  }finally{rmSync(dir,{recursive:true});}
});
test('SQL bounds match shared price constants and reject uppercase email',async()=>{
  const db=openLocalDatabase();try{
    await createDraft(db,input);
    for(const amount of [LIMITS.minPriceCents,LIMITS.maxPriceCents])db.sqlite.prepare('UPDATE gear_listings SET price_cents=?').run(amount);
    for(const amount of [LIMITS.minPriceCents-1,LIMITS.maxPriceCents+1])assert.throws(()=>db.sqlite.prepare('UPDATE gear_listings SET price_cents=?').run(amount));
    assert.throws(()=>db.sqlite.exec("UPDATE gear_sellers SET email='UPPER@example.test'"));
  }finally{db.close();}
});
