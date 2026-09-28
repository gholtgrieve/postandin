import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {localServer} from '../scripts/gear/local-server.mjs';
import {localContact,CONTACT_WINDOW_MS} from '../scripts/gear/local-contact.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink} from '../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../lib/gear-email-change.mjs';
const listing={title:'Sample bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
const message=id=>({id,name:' Buyer ',email:' BUYER@Example.test ',message:'<script>alert(1)</script>\nIs this available?',shareEmail:true});
async function publish(db){const {id}=await createDraft(db,listing);const receipt=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,receipt.token)).verified,true);return id;}
const status=(code)=>e=>e.status===code;
test('local contact normalizes buyer data, stores plain text privately, and uses current seller address',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),contact=localContact(db);
  const result=contact.send({...message(id),recipient:'attacker@example.test',sellerId:'ignored'});
  assert.deepEqual(result,{ok:true,message:'Saved to the local test inbox. No email was sent.'});
  assert.equal(contact.receipts[0].recipient,listing.email);assert.equal(contact.receipts[0].buyerEmail,'buyer@example.test');assert.equal(contact.receipts[0].buyerName,'Buyer');assert.equal(contact.receipts[0].message,message(id).message);
  const oldSeller=db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(id).seller_id;
  const link=await issueLocalManagementLink(db,listing.email);
  const access=await redeemManagementLink(db,link.token);
  const transfer=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test');
  assert.equal(await confirmEmailChange(db,transfer.token),true);
  assert.notEqual(db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(id).seller_id,oldSeller);
  assert.equal(db.sqlite.prepare('SELECT email FROM gear_sellers WHERE id=?').get(oldSeller).email,listing.email);
  db.sqlite.prepare("UPDATE gear_listings SET status='pending' WHERE id=?").run(id);
  contact.send(message(id));assert.equal(contact.receipts[1].recipient,'new@example.test');
  assert.equal(JSON.stringify(await readPublicListings(db)).includes('@'),false);
 }finally{db.close();}
});
test('malformed, overlong, control-character and unacknowledged contact never reaches sink',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),contact=localContact(db);
  for(const input of [null,[],{},...[
   {id:'bad'},{name:' '},{name:'x'.repeat(61)},{name:'a\r\nb'},
   {email:'bad'},{email:'a@b.test\r\nBcc:x@y.test'},{email:'x'.repeat(255)+'@a.test'},
   {message:' '},{message:'x'.repeat(2001)},{message:'hello\0world'},
   {shareEmail:false},{shareEmail:'true'}
  ].map(p=>({...message(id),...p}))])assert.throws(()=>contact.send(input),status(400));
  assert.equal(contact.receipts.length,0);
  // Malformed attempts must not consume this same buyer/listing budget.
  for(let i=0;i<3;i++)assert.equal(contact.send(message(id)).ok,true);
  assert.equal(contact.receipts.length,3);
 }finally{db.close();}
});
test('eligibility rejects missing, unverified, closed, expired, removed and exact-expiry listings',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),now=Date.now();
  const attempt=()=>localContact(db).send(message(id),now);
  for(const value of ['unverified','closed','expired','removed']){
   db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(value,id);assert.throws(attempt,status(404));
  }
  db.sqlite.prepare("UPDATE gear_listings SET status='available',expires_at=? WHERE id=?").run(now,id);assert.throws(attempt,status(404));
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now+1,id);assert.equal(attempt().ok,true);
  db.sqlite.prepare("UPDATE gear_listings SET status='unverified',expires_at=?,verified_at=NULL WHERE id=?").run(now+10000,id);assert.throws(attempt,status(404));
  db.sqlite.prepare("UPDATE gear_listings SET status='available',verified_at=? WHERE id=?").run(now,id);
  db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL').run();assert.throws(attempt,status(404));
  assert.throws(()=>localContact(db).send(message(crypto.randomUUID())),status(404));
 }finally{db.close();}
});
test('per-listing, per-buyer and global limits count attempts and expire at the boundary; inbox is bounded',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),now=Date.now(),contact=localContact(db);
  for(let i=0;i<3;i++)contact.send(message(id),now);
  assert.throws(()=>contact.send(message(id),now),status(429));
  for(let i=0;i<2;i++)assert.throws(()=>contact.send(message(crypto.randomUUID()),now),status(404));
  assert.throws(()=>contact.send(message(crypto.randomUUID()),now),status(429));
  assert.throws(()=>contact.send(message(id),now+CONTACT_WINDOW_MS-1),status(429));
  contact.send(message(id),now+CONTACT_WINDOW_MS);
  const global=localContact(db);
  for(let i=0;i<60;i++)global.send({...message(id),email:`buyer${i}@example.test`},now);
  assert.equal(global.receipts.length,20);assert.equal(global.receipts[0].buyerEmail,'buyer40@example.test');
  assert.throws(()=>global.send({...message(id),email:'extra@example.test'},now),status(429));
  assert.equal(localContact(db).receipts.length,0);
 }finally{db.close();}
});
test('missing, negative and throwing delivery cannot report success',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db);
  for(const sink of [null,()=>false,()=>{throw new Error('private sink failure');}]){
   const contact=localContact(db,{sink});
   for(let i=0;i<3;i++)assert.throws(()=>contact.send(message(id)),e=>e instanceof Error&&e.status!==429);
   assert.throws(()=>contact.send(message(id)),status(429));
   assert.equal(contact.receipts.length,0);
  }
 }finally{db.close();}
});
test('HTTP requires same Origin and JSON; private receipt stays out of public response; errors are safe',async()=>{
 const db=openLocalDatabase(),id=await publish(db);let server=localServer(db);
 const listen=async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};let base=await listen();
 const post=(input=message(id),headers={})=>fetch(base+'/contact',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 try{
  for(const origin of ['', 'null','https://example.test'])assert.equal((await post(message(id),{Origin:origin})).status,403);
  assert.equal((await post(message(id),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await post(message(id),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await fetch(base+'/contact')).status,404);
  assert.equal((await post({...message(id),shareEmail:false})).status,400);
  const sent=await post();assert.equal(sent.status,200);assert.equal(sent.headers.get('cache-control'),'no-store');assert.equal(JSON.stringify(await sent.json()).includes('@'),false);
  const inbox=await(await fetch(base+'/local/contact-mail')).json();assert.equal(inbox.receipts.length,1);assert.equal(inbox.receipts[0].recipient,listing.email);
  assert.equal((await fetch(base+'/local/contact-mail',{headers:{Origin:'https://example.test'}})).status,403);
  assert.equal((await post(message(crypto.randomUUID()))).status,404);
  await post();await post();assert.equal((await post()).status,429);
  await new Promise(r=>server.close(r));server=localServer(db,{contactSink:()=>{throw new Error('private delivery detail');}});base=await listen();
  const logged=console.error,errors=[];console.error=(...a)=>errors.push(a);
  try{const failed=await post();assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'Unable to process the request.'});assert.equal(errors.length,1);}finally{console.error=logged;}
 }finally{await new Promise(r=>server.close(r));db.close();}
});
