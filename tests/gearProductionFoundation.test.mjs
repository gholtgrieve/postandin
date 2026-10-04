import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADULT_ACKNOWLEDGEMENT_VERSION, LIMITS } from '../lib/gear-exchange.mjs';
import { recordHostedPhoto, readHostedPhotos } from '../lib/gear-photo-storage.mjs';
import { createDraft } from '../lib/gear-storage.mjs';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';

const input={title:'Club bag',description:'Worn zipper, repaired seam.',city:'Seattle',fit:'Junior bag',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4050,clubs:['Kent Valley']};
const providerId=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;

test('new drafts record immutable adult acknowledgement evidence',async()=>{
  const db=openLocalDatabase();
  try{
    const {id}=await createDraft(db,input,1234);
    const acknowledgement=db.sqlite.prepare('SELECT adult_acknowledged_at,disclosure_version FROM gear_listings WHERE id=?').get(id);
    assert.equal(acknowledgement.adult_acknowledged_at,1234);
    assert.equal(acknowledgement.disclosure_version,ADULT_ACKNOWLEDGEMENT_VERSION);
    assert.throws(()=>db.sqlite.prepare('UPDATE gear_listings SET adult_acknowledged_at=? WHERE id=?').run(1235,id),/immutable/);
    assert.throws(()=>db.sqlite.prepare('UPDATE gear_listings SET disclosure_version=? WHERE id=?').run('later',id),/immutable/);
    assert.throws(()=>db.sqlite.prepare(`INSERT INTO gear_listings
      (id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,created_at,duplicate_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),db.sqlite.prepare('SELECT id FROM gear_sellers').get().id,'Sample','Other bag','Wear','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,1234,'key'),/Adult acknowledgement required/);
    const insert=db.sqlite.prepare(`INSERT INTO gear_listings
      (id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,created_at,duplicate_key,adult_acknowledged_at,disclosure_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const sellerId=db.sqlite.prepare('SELECT id FROM gear_sellers').get().id;
    const values=(acknowledgedAt,version)=>[crypto.randomUUID(),sellerId,'Sample','Other bag','Wear','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,1234,crypto.randomUUID(),acknowledgedAt,version];
    assert.throws(()=>insert.run(...values(1235,ADULT_ACKNOWLEDGEMENT_VERSION)),/Adult acknowledgement required/);
    assert.throws(()=>insert.run(...values(1234,'gear-adult-v2')),/Adult acknowledgement required/);
  }finally{db.close();}
});

test('production migrations preserve legacy listings without inventing acknowledgement',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-v6-')),path=join(dir,'db.sqlite');
  const legacy=new DatabaseSync(path);
  try{
    legacy.exec('PRAGMA foreign_keys=ON');
    for(let version=1;version<=6;version++){
      const prefix=String(version).padStart(4,'0');
      const name={1:'drafts',2:'verification',3:'duplicates',4:'publication_duplicates',5:'management',6:'email_change'}[version];
      legacy.exec(readFileSync(new URL(`../migrations/gear/${prefix}_${name}.sql`,import.meta.url),'utf8'));
    }
    legacy.exec('CREATE TABLE gear_local_migrations(version INTEGER PRIMARY KEY)');
    for(let version=1;version<=6;version++)legacy.prepare('INSERT INTO gear_local_migrations VALUES(?)').run(version);
    legacy.exec("INSERT INTO gear_sellers(id,email,created_at) VALUES('seller','legacy@example.test',100)");
    legacy.exec("INSERT INTO gear_listings(id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,created_at,duplicate_key) VALUES('legacy','seller','Legacy','Bag','Wear','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,100,'legacy-key')");
  }finally{legacy.close();}
  try{
    const db=openLocalDatabase(path);
    try{
      assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_migrations').get().n,19);
      const acknowledgement=db.sqlite.prepare("SELECT adult_acknowledged_at,disclosure_version FROM gear_listings WHERE id='legacy'").get();
      assert.equal(acknowledgement.adult_acknowledged_at,null);
      assert.equal(acknowledgement.disclosure_version,null);
      const created=await createDraft(db,input,200);
      assert.equal(db.sqlite.prepare('SELECT disclosure_version FROM gear_listings WHERE id=?').get(created.id).disclosure_version,ADULT_ACKNOWLEDGEMENT_VERSION);
    }finally{db.close();}
  }finally{rmSync(dir,{recursive:true});}
});

test('production seller deletion marker is constrained and its purge ledger survives listing deletion',async()=>{
  const db=openLocalDatabase();
  try{
    const {id}=await createDraft(db,input,100);
    assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='gear_deletions_due'").get());
    assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='gear_deletion_ledger_retention'").get());
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'unverified',200,300),/CHECK constraint/);
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'closed',200,200),/CHECK constraint/);
    db.sqlite.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').run(id,'closed',200,300);
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,?)').run(id,200,300,299),/CHECK constraint/);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(id,200,300);
    db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(id);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_deletions').get().n,0);
    assert.deepEqual({...db.sqlite.prepare('SELECT * FROM gear_deletion_ledger').get()},{listing_id:id,deleted_at:200,purge_at:300,purged_at:null});
  }finally{db.close();}
});

test('migration 16 puts legacy closed listings on the 30-day removal clock',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'gear-v16-')),path=join(dir,'db.sqlite');
  try{
    let db=openLocalDatabase(path);
    const {id}=await createDraft(db,input,100);
    db.sqlite.prepare("UPDATE gear_listings SET status='closed',verified_at=100,expires_at=200 WHERE id=?").run(id);
    db.sqlite.prepare('DELETE FROM gear_local_migrations WHERE version=16').run();db.close();
    db=openLocalDatabase(path);
    try{
      assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
      const deletion=db.sqlite.prepare('SELECT previous_status,deleted_at,purge_at FROM gear_deletions WHERE listing_id=?').get(id);
      assert.equal(deletion.previous_status,'closed');assert.equal(deletion.purge_at-deletion.deleted_at,30*86400000);
      assert.deepEqual({...db.sqlite.prepare('SELECT deleted_at,purge_at,purged_at FROM gear_deletion_ledger WHERE listing_id=?').get(id)},{deleted_at:deletion.deleted_at,purge_at:deletion.purge_at,purged_at:null});
    }finally{db.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('hosted photo metadata is ordered, capped, private and cascade-deleted',async()=>{
  const db=openLocalDatabase();
  try{
    const {id}=await createDraft(db,input,100);
    const first=await recordHostedPhoto(db,id,providerId(1),101);
    assert.equal(first.position,0);assert.equal(first.providerId,providerId(1));assert.equal(first.createdAt,101);
    await assert.rejects(recordHostedPhoto(db,id,providerId(1),102),/UNIQUE constraint/);
    for(let index=2;index<=LIMITS.photos;index++)assert.equal((await recordHostedPhoto(db,id,providerId(index),100+index)).position,index-1);
    assert.equal(await recordHostedPhoto(db,id,providerId(7),107),null);
    db.sqlite.prepare('DELETE FROM gear_photos WHERE listing_id=? AND position=2').run(id);
    assert.equal((await recordHostedPhoto(db,id,providerId(7),107)).position,2);
    assert.equal(await recordHostedPhoto(db,'00000000-0000-4000-8000-999999999999',providerId(8),108),null);
    const rows=await readHostedPhotos(db,id);
    assert.deepEqual(rows.map(row=>row.position),[0,1,2,3,4,5]);
    assert.deepEqual(Object.keys(rows[0]).sort(),['createdAt','id','listingId','position','providerId']);
    db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(id);
    assert.deepEqual(await readHostedPhotos(db,id),[]);
  }finally{db.close();}
});

test('hosted photo metadata rejects malformed identifiers and clocks',async()=>{
  const db=openLocalDatabase();
  try{
    const {id}=await createDraft(db,input);
    for(const args of [['bad',providerId(1),1],[id,'not-random',1],[id,providerId(1),-1],[id,providerId(1),1.5]]){
      await assert.rejects(recordHostedPhoto(db,...args),TypeError);
    }
    await assert.rejects(readHostedPhotos(db,'BAD'),TypeError);
  }finally{db.close();}
});
