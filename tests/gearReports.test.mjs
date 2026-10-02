import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {localReports,REPORT_WINDOW_MS} from '../scripts/gear/local-reports.mjs';
import {localServer} from '../scripts/gear/local-server.mjs';
import {REPORT_REASONS} from '../lib/gear-exchange.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
const sample={title:'<b>Sample bag</b>',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db){const {id}=await createDraft(db,sample);const receipt=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,receipt.token)).verified,true);return id;}
const input=id=>({id,reason:REPORT_REASONS[0]});
const status=n=>e=>e.status===n;
test('reports queue only explicit fields; accepted reasons never change listing or public projection',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),queue=localReports(db),before=JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_listings').all()),publicBefore=await readPublicListings(db),now=Date.now();
  for(let i=0;i<REPORT_REASONS.length;i++){
   const result=queue.submit({...input(id),reason:REPORT_REASONS[i],email:'ignore@example.test',status:'removed',sellerId:'ignored'},now+i*REPORT_WINDOW_MS);
   assert.deepEqual(result,{ok:true,message:'Report saved to the local review queue. No moderation action was taken.'});
  }
  assert.equal(queue.reports.length,4);assert.deepEqual(Object.keys(queue.reports[0]).sort(),['createdAt','id','listingId','listingTitle','reason'].sort());
  assert.equal(queue.reports[0].listingTitle,sample.title);assert.equal(queue.reports[0].listingId,id);
  assert.equal(new Set(queue.reports.map(r=>r.id)).size,4);assert.equal(JSON.stringify(queue.reports).includes('@'),false);
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_listings').all()),before);assert.deepEqual(await readPublicListings(db),publicBefore);
 }finally{db.close();}
});
test('invalid report shapes and unsupported reasons do not consume the submission budget',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),queue=localReports(db);
  for(const bad of [null,[],1,'report',{},...[
   {id:null},{id:'bad'},{reason:null},{reason:[]},{reason:''},{reason:' '},{reason:'Other concern\n'},{reason:'<script>'},{reason:'x'.repeat(2000)}
  ].map(p=>({...input(id),...p}))])assert.throws(()=>queue.submit(bad),status(400));
  for(let i=0;i<3;i++)assert.equal(queue.submit(input(id)).ok,true);
  assert.throws(()=>queue.submit(input(id)),status(429));assert.equal(queue.reports.length,3);
 }finally{db.close();}
});
test('reports require current public eligibility and reject exact expiry without revealing private data',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),now=Date.now(),send=()=>localReports(db).submit(input(id),now);
  db.sqlite.prepare("UPDATE gear_listings SET status='pending' WHERE id=?").run(id);assert.equal(send().ok,true);
  for(const value of ['unverified','closed','expired','removed']){db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(value,id);assert.throws(send,status(404));}
  db.sqlite.prepare("UPDATE gear_listings SET status='available',expires_at=? WHERE id=?").run(now,id);assert.throws(send,status(404));
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now+1,id);assert.equal(send().ok,true);
  db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL').run();assert.throws(send,status(404));
  const draft=await createDraft(db,{...sample,title:'Unverified'});assert.throws(()=>localReports(db).submit(input(draft.id)),status(404));
  assert.throws(()=>localReports(db).submit(input(crypto.randomUUID())),status(404));
 }finally{db.close();}
});
test('local listing/global limits count unavailable attempts and reset at the exact window; queue stays bounded',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),queue=localReports(db),now=Date.now();
  for(let i=0;i<3;i++)queue.submit(input(id),now);
  assert.throws(()=>queue.submit(input(id),now+REPORT_WINDOW_MS-1),status(429));
  assert.equal(queue.submit(input(id),now+REPORT_WINDOW_MS).ok,true);
  const failed=localReports(db),missing=crypto.randomUUID();
  for(let i=0;i<3;i++)assert.throws(()=>failed.submit(input(missing),now),status(404));
  assert.throws(()=>failed.submit(input(missing),now),status(429));
  for(let i=3;i<20;i++)assert.throws(()=>failed.submit(input(crypto.randomUUID()),now),status(404));
  assert.throws(()=>failed.submit(input(id),now),status(429));assert.equal(failed.reports.length,0);
  assert.equal(failed.submit(input(id),now+REPORT_WINDOW_MS).ok,true);
  const bounded=localReports(db);for(let i=0;i<24;i++)bounded.submit(input(id),now+i*REPORT_WINDOW_MS);
  assert.equal(bounded.reports.length,20);assert.equal(bounded.reports[0].createdAt,now+4*REPORT_WINDOW_MS);
  const fresh=localReports(db);assert.equal(fresh.reports.length,0);assert.equal(fresh.submit(input(id),now).ok,true);
 }finally{db.close();}
});
test('HTTP report guards, inspection privacy, request bounds and generic database failure',async()=>{
 const db=openLocalDatabase(),id=await publish(db),server=localServer(db);let closed=false;
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(body=input(id),headers={})=>fetch(base+'/reports',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/reports')).status,404);
  assert.equal((await fetch(base+'/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input(id))})).status,403);
  for(const origin of ['null','https://example.test'])assert.equal((await post(input(id),{Origin:origin})).status,403);
  assert.equal((await post(input(id),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await post(input(id),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post({id,reason:'bad'})).status,400);
  assert.equal((await post({...input(id),extra:'x'.repeat(33000)})).status,413);
  assert.equal((await fetch(base+'/reports',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{'})).status,400);
  const ok=await post();assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(await ok.json()).sort(),['message','ok']);
  const inspection=await fetch(base+'/local/reports');assert.equal(inspection.headers.get('cache-control'),'no-store');const {reports}=await inspection.json();assert.equal(reports.length,1);assert.equal(reports[0].listingId,id);
  for(const headers of [{Origin:'https://example.test'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(base+'/local/reports',{headers})).status,403);
  assert.equal((await post(input(crypto.randomUUID()))).status,404);
  const responses=await Promise.all([post(),post(),post()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,200,429]);
  assert.equal((await(await fetch(base+'/listings')).json()).listings.length,1);
  db.close();closed=true;const logged=console.error,errors=[];console.error=(...args)=>errors.push(args);
  try{const failureId=crypto.randomUUID();for(let i=0;i<3;i++){const failed=await post(input(failureId));assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'Unable to process the request.'});}assert.equal((await post(input(failureId))).status,429);assert.equal(errors.length,3);}finally{console.error=logged;}
  assert.equal((await(await fetch(base+'/local/reports')).json()).reports.length,3);
 }finally{await new Promise(r=>server.close(r));if(!closed)db.close();}
});
