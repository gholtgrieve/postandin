import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft } from '../lib/gear-storage.mjs';
import { GearAccessDeniedError, GearAccessUnavailableError } from '../lib/gear-access.mjs';
import { readOpenModerationReports } from '../lib/gear-moderation-storage.mjs';
import { createOwnerReportsHandler, onRequestGet } from '../functions/api/gear/admin/reports.js';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';

const sample={title:'Club bag',description:'Worn zipper, repaired seam.',city:'Seattle',fit:'Junior bag',sellerName:'Sample seller',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4050,clubs:['Kent Valley']};

async function listing(db) {
  const {id}=await createDraft(db,sample,100);
  db.sqlite.prepare("UPDATE gear_sellers SET verified_at=101 WHERE email=?").run(sample.email);
  db.sqlite.prepare("UPDATE gear_listings SET status='available',verified_at=101,expires_at=999999 WHERE id=?").run(id);
  return id;
}

const request=()=>new Request('https://gear-admin.postandin.com/api/gear/admin/reports');
const context=(db,extra={})=>({request:request(),env:{GEAR_DB:db,...extra}});

test('migration 8 adds constrained production moderation tables',async()=>{
  const db=openLocalDatabase();
  try{
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_migrations').get().n,13);
    assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='gear_reports_listing'").get());
    const id=await listing(db),reportId=crypto.randomUUID();
    db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)')
      .run(reportId,id,'Original title','Other concern',200);
    assert.equal(db.sqlite.prepare('SELECT resolution FROM gear_reports WHERE id=?').get(reportId).resolution,'open');
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)')
      .run(crypto.randomUUID(),id,'Title','Unsupported',201),/CHECK constraint/);
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_removals VALUES(?,?,?,?)').run(id,'closed',202,'Reason'),/CHECK constraint/);
    assert.throws(()=>db.sqlite.prepare('INSERT INTO gear_moderation_history(actor,action,listing_id,reason,before_status,after_status,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('owner@example.test','purge',id,'Reason','available','removed',203),/CHECK constraint/);
  }finally{db.close();}
});

test('moderation projection returns only 100 newest open reports without private seller data',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await listing(db),rows=[];
    for(let index=0;index<102;index++){
      const reportId=crypto.randomUUID(),createdAt=index===100||index===101?500:index;
      db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at,resolution) VALUES(?,?,?,?,?,?)')
        .run(reportId,id,`Snapshot ${index}`,'Other concern',createdAt,index===0?'dismissed':'open');
      rows.push({reportId,createdAt,index});
    }
    const {reports,truncated}=await readOpenModerationReports(db);
    const expected=rows.filter(row=>row.index!==0)
      .sort((left,right)=>right.createdAt-left.createdAt||(left.reportId<right.reportId?-1:1))
      .slice(0,100).map(row=>row.reportId);
    assert.equal(reports.length,100);
    assert.equal(truncated,true);
    assert.deepEqual(reports.map(row=>row.reportId),expected);
    assert.deepEqual(Object.keys(reports[0]).sort(),['createdAt','listing','listingId','listingTitle','reason','reportId','resolution']);
    assert.deepEqual(Object.keys(reports[0].listing).sort(),['category','city','condition','description','expiresAt','fit','priceCents','sellerName','size','status','title','trade','type']);
    assert.equal(JSON.stringify(reports).includes(sample.email),false);
    assert.equal(JSON.stringify(reports).includes('seller_id'),false);
    assert.equal(JSON.stringify(reports).includes('adult_acknowledged'),false);
  }finally{db.close();}
});

test('owner reports route authenticates before reading D1 and returns no-store JSON',async()=>{
  const db=openLocalDatabase();
  try{
    const id=await listing(db);
    db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)')
      .run(crypto.randomUUID(),id,'Original title','Prohibited item',200);
    let verifiedRequest,verifiedEnv;
    const handler=createOwnerReportsHandler({verify:async(value,env)=>{verifiedRequest=value;verifiedEnv=env;}});
    const response=await handler(context(db,{marker:'test'}));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(verifiedRequest.url,request().url);
    assert.equal(verifiedEnv.marker,'test');
    const body=await response.json();
    assert.equal(body.reports.length,1);
    assert.equal(body.truncated,false);
  }finally{db.close();}
});

test('owner reports route fails closed before D1 and keeps failures generic',async()=>{
  const logged=console.error,errors=[];console.error=(...args)=>errors.push(args);
  try{
    let reads=0;
    const readReports=async()=>{reads++;throw new Error('private database detail');};
    const denied=createOwnerReportsHandler({verify:async()=>{throw new GearAccessDeniedError();},readReports});
    let response=await denied({request:request(),env:{}});
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'Access denied.'});assert.equal(reads,0);
    const unavailable=createOwnerReportsHandler({verify:async()=>{throw new GearAccessUnavailableError('private key detail');},readReports});
    response=await unavailable(context({}));
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Owner access is temporarily unavailable.'});assert.equal(reads,0);
    const missing=createOwnerReportsHandler({verify:async()=>{},readReports});
    response=await missing({request:request(),env:{}});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Gear moderation is temporarily unavailable.'});assert.equal(reads,0);
    const failed=createOwnerReportsHandler({verify:async()=>{},readReports});
    response=await failed(context({}));
    const failedBody=await response.json();
    assert.equal(response.status,500);assert.deepEqual(failedBody,{error:'Unable to load moderation reports right now.'});assert.equal(reads,1);
    assert.equal(JSON.stringify(failedBody).includes('private'),false);
    assert.equal(errors.some(entry=>String(entry.at(-1)).includes('private database detail')),true);
    let prepares=0;
    response=await onRequestGet({
      request:new Request('https://www.postandin.com/api/gear/admin/reports'),
      env:{GEAR_DB:{prepare(){prepares++;throw new Error('must not read');}}},
    });
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'Access denied.'});assert.equal(prepares,0);
  }finally{console.error=logged;}
});
