import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {claimContactDelivery,markContactSent,reserveContact,validateContactSubmission} from '../lib/gear-contact-storage.mjs';
import {GearContactMailUnavailableError,sendContactMessage} from '../lib/gear-contact-mail.mjs';
import {createContactHandler} from '../functions/api/gear/contact.js';
import {createTurnstileVerifier,GearTurnstileRejectedError,GearTurnstileUnavailableError} from '../lib/gear-turnstile.mjs';
import {cleanupGearRecords} from '../lib/gear-maintenance.mjs';

const sample={title:'Sample bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Seller',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const providerId='00000000-0000-4000-8000-000000000099';
async function publish(db,now=100,patch={}){const {id}=await createDraft(db,{...sample,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
const raw=(id,patch={})=>({id,requestId:crypto.randomUUID(),name:' Buyer ',email:'BUYER@example.test ',message:' Is this still available? ',shareEmail:true,adult:true,turnstileToken:'sample-token',...patch});
const valid=value=>{const result=validateContactSubmission(value);assert.ok(result);return result;};
const request=(value,options={})=>new Request(options.url??'https://postandin.com/api/gear/contact',{method:'POST',headers:{Origin:'https://postandin.com','Content-Type':'application/json',...options.headers},body:typeof value==='string'?value:JSON.stringify(value)});

test('production contact reservation is idempotent, private, eligible and durably limited',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),now=200,first=valid(raw(id));
    const reserved=await reserveContact(db,first,now);assert.equal(reserved.replay,false);assert.deepEqual({...reserved.contact},{id:first.requestId,listingId:id,listingTitle:sample.title,recipient:sample.email,buyerName:'Buyer',buyerEmail:'buyer@example.test',message:'Is this still available?',status:'pending',providerId:null,createdAt:now,expiresAt:now+86400000});
    assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_contact_attempts').get()).includes('buyer@example.test'),false);
    assert.equal((await reserveContact(db,first,now+1)).replay,true);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_attempts').get().n,1);
    assert.deepEqual(await reserveContact(db,{...first,message:'Different'},now+1),{conflict:true});
    await assert.rejects(reserveContact(db,{...first,email:'UPPER@example.test'},now+1),TypeError);
    const claim=await claimContactDelivery(db,first.requestId,now+2);assert.equal(claim.claimed,true);assert.equal(await markContactSent(db,first.requestId,providerId,now+2,claim.token),true);assert.equal(await markContactSent(db,first.requestId,providerId,now+3,claim.token),true);assert.equal((await reserveContact(db,first,now+4)).contact.status,'sent');
    for(let index=0;index<2;index++)assert.ok((await reserveContact(db,valid(raw(id)),now+5+index)).contact);
    assert.deepEqual(await reserveContact(db,valid(raw(id)),now+7),{limited:true});
    db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(id);
    const unavailable=valid(raw(id,{email:'other@example.test'}));assert.deepEqual(await reserveContact(db,unavailable,now+8),{unavailable:true});
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_attempts WHERE id=?').get(unavailable.requestId).n,1);
  }finally{db.close();}
});

test('contact validation rejects malformed, unacknowledged and unsafe fields',()=>{
  const id=crypto.randomUUID(),base=raw(id);
  for(const patch of [{id:'bad'},{requestId:'bad'},{name:''},{name:'x'.repeat(61)},{name:'bad\nname'},{email:'bad'},{message:''},{message:'x'.repeat(2001)},{message:'bad\u0000message'},{shareEmail:false},{adult:false},{turnstileToken:null}])assert.equal(validateContactSubmission({...base,...patch}),null);
  assert.deepEqual(valid(base),{listingId:id,requestId:base.requestId,name:'Buyer',email:'buyer@example.test',message:'Is this still available?',turnstileToken:'sample-token'});
});

test('pending replays reject expiry, removal and seller-address changes',async()=>{
  const db=openLocalDatabase();try{
    const now=200,id=await publish(db),input=valid(raw(id));await reserveContact(db,input,now);
    assert.deepEqual(await reserveContact(db,input,now+86400000),{expired:true});
    db.sqlite.prepare("UPDATE gear_sellers SET email='new-seller@example.test' WHERE email=?").run(sample.email);
    assert.deepEqual(await reserveContact(db,input,now+1),{stale:true});
    const current=valid(raw(id));assert.equal((await reserveContact(db,current,now+2)).contact.recipient,'new-seller@example.test');
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);assert.deepEqual(await reserveContact(db,current,now+3),{unavailable:true});
  }finally{db.close();}
});

test('delivery claim atomically rejects seller-address changes and removed listings',async()=>{
  const db=openLocalDatabase();try{
    const now=200,id=await publish(db),stale=valid(raw(id));await reserveContact(db,stale,now);
    db.sqlite.prepare("UPDATE gear_sellers SET email='new-seller@example.test' WHERE email=?").run(sample.email);
    assert.deepEqual(await claimContactDelivery(db,stale.requestId,now+1),{stale:true});
    const current=valid(raw(id));await reserveContact(db,current,now+2);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
    assert.deepEqual(await claimContactDelivery(db,current.requestId,now+3),{unavailable:true});
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_contact_messages WHERE status='sending'").get().n,0);
  }finally{db.close();}
});

test('production contact enforces buyer and global limits and cascades private copies',async()=>{
  const db=openLocalDatabase();try{
    const now=200,first=await publish(db),second=await publish(db,101,{title:'Second sample bag'});
    for(let index=0;index<3;index++)assert.ok((await reserveContact(db,valid(raw(first)),now+index)).contact);
    for(let index=0;index<2;index++)assert.ok((await reserveContact(db,valid(raw(second)),now+3+index)).contact);
    assert.deepEqual(await reserveContact(db,valid(raw(second)),now+5),{limited:true});
    db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(first);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_messages WHERE listing_id=?').get(first).n,0);
  }finally{db.close();}
  const global=openLocalDatabase();try{
    const now=200,id=await publish(global);for(let index=0;index<60;index++)assert.ok((await reserveContact(global,valid(raw(id,{email:`buyer${index}@example.test`})),now)).contact);
    assert.deepEqual(await reserveContact(global,valid(raw(id,{email:'extra@example.test'})),now),{limited:true});
  }finally{global.close();}
});

test('unverified sellers and exact-expiry listings cannot create contact copies',async()=>{
  const db=openLocalDatabase();try{
    const now=200,id=await publish(db);db.sqlite.prepare('UPDATE gear_sellers SET verified_at=NULL').run();assert.deepEqual(await reserveContact(db,valid(raw(id)),now),{unavailable:true});
    db.sqlite.prepare('UPDATE gear_sellers SET verified_at=100').run();db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now,id);assert.deepEqual(await reserveContact(db,valid(raw(id,{email:'other@example.test'})),now),{unavailable:true});
  }finally{db.close();}
});

test('maintenance removes contact attempts and private copies at their exact boundaries',async()=>{
  const db=openLocalDatabase();try{
    const now=1000000,id=await publish(db,now),input=valid(raw(id));await reserveContact(db,input,now);
    await cleanupGearRecords(db,{now:now+10*60*1000-1});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_attempts').get().n,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_messages').get().n,1);
    await cleanupGearRecords(db,{now:now+10*60*1000});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_attempts').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_messages').get().n,1);
    await cleanupGearRecords(db,{now:now+86400000});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_contact_messages').get().n,0);
  }finally{db.close();}
});

test('Resend contact adapter fixes sender, recipient and idempotency while keeping user text plain',async()=>{
  const contact={id:crypto.randomUUID(),recipient:'seller@example.test',buyerEmail:'buyer@example.test',buyerName:'Buyer',listingTitle:'Sample bag',message:'Plain <b>question</b>'};let target,options;
  assert.deepEqual(await sendContactMessage(contact,{GEAR_RESEND_API_KEY:'test_key'},{fetcher:async(...args)=>{[target,options]=args;return Response.json({id:providerId});}}),{id:providerId});
  assert.equal(target,'https://api.resend.com/emails');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer test_key');assert.equal(options.headers['Idempotency-Key'],`gear-contact-${contact.id}`);
  const body=JSON.parse(options.body);assert.deepEqual(body.to,['seller@example.test']);assert.equal(body.reply_to,'buyer@example.test');assert.equal(body.from,'Post & In Gear <gear@postandin.com>');assert.equal('html' in body,false);assert.match(body.text,/Plain <b>question<\/b>/);
  for(const [env,fetcher,code] of [[{},async()=>Response.json({id:providerId}),'config'],[{GEAR_RESEND_API_KEY:'key'},async()=>new Response('{}',{status:500}),'status:500'],[{GEAR_RESEND_API_KEY:'key'},async()=>new Response('x'.repeat(4097)),'response'],[{GEAR_RESEND_API_KEY:'key'},async()=>{throw new Error('private');},'network']])await assert.rejects(sendContactMessage(contact,env,{fetcher}),error=>error instanceof GearContactMailUnavailableError&&error.code===code);
  await assert.rejects(sendContactMessage(contact,{GEAR_RESEND_API_KEY:'key'},{timeoutMs:5,fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private timeout')),{once:true}))}),error=>error instanceof GearContactMailUnavailableError&&error.code==='network');
});

test('dedicated contact Turnstile action rejects tokens issued for other Gear actions',async()=>{
  const verify=createTurnstileVerifier({expectedAction:'gear-contact',fetchImpl:async()=>Response.json({success:true,hostname:'postandin.com',action:'gear-post'})});
  await assert.rejects(verify('sample-token',{GEAR_TURNSTILE_SECRET:'sample-secret'}),GearTurnstileRejectedError);
});

test('public contact route verifies, reserves and delivers once without exposing private fields',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),value=raw(id),tokens=[],deliveries=[];
    const handler=createContactHandler({verify:async token=>tokens.push(token),deliver:async contact=>{deliveries.push(contact);return {id:providerId};},now:()=>200});
    let response=await handler({request:request(value),env:{GEAR_DB:db,GEAR_RESEND_API_KEY:'test_key',GEAR_CONTACT_ENABLED:'true'}});assert.equal(response.status,202);assert.deepEqual(await response.json(),{ok:true,message:'Message accepted for delivery.'});
    response=await handler({request:request(value),env:{GEAR_DB:db,GEAR_RESEND_API_KEY:'test_key',GEAR_CONTACT_ENABLED:'true'}});assert.equal(response.status,202);assert.equal(deliveries.length,1);assert.deepEqual(tokens,['sample-token','sample-token']);
    const publicBody=JSON.stringify(await response.json());assert.equal(publicBody.includes('@'),false);assert.equal(publicBody.includes('available?'),false);
  }finally{db.close();}
});

test('failed receipt persistence retries one idempotent delivery after the claim lease',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),value=raw(id),env={GEAR_DB:db,GEAR_RESEND_API_KEY:'test_key',GEAR_CONTACT_ENABLED:'true'};let clock=200,deliveries=0,marks=0;
    const handler=createContactHandler({verify:async()=>{},deliver:async()=>{deliveries++;return {id:providerId};},mark:async(...args)=>{if(marks++===0)throw new Error('lost D1 response');return markContactSent(...args);},now:()=>clock});
    assert.equal((await handler({request:request(value),env})).status,503);assert.equal(db.sqlite.prepare('SELECT status FROM gear_contact_messages').get().status,'sending');
    const busy=await handler({request:request(value),env});assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'60');assert.equal(deliveries,1);
    clock+=60001;assert.equal((await handler({request:request(value),env})).status,202);assert.equal(deliveries,2);assert.equal(db.sqlite.prepare('SELECT status FROM gear_contact_messages').get().status,'sent');
  }finally{db.close();}
});

test('simultaneous identical requests create one provider delivery claim',async()=>{
  const db=openLocalDatabase();try{
    const id=await publish(db),value=raw(id),env={GEAR_DB:db,GEAR_RESEND_API_KEY:'test_key',GEAR_CONTACT_ENABLED:'true'};let releaseDelivery,deliveries=0;const gate=new Promise(resolve=>{releaseDelivery=resolve;});let startedResolve;const started=new Promise(resolve=>{startedResolve=resolve;});
    const handler=createContactHandler({verify:async()=>{},deliver:async()=>{deliveries++;startedResolve();await gate;return {id:providerId};},now:()=>200});
    const first=handler({request:request(value),env});await started;const second=await handler({request:request(value),env});assert.equal(second.status,503);assert.equal(second.headers.get('retry-after'),'60');assert.equal(deliveries,1);releaseDelivery();assert.equal((await first).status,202);assert.equal(db.sqlite.prepare('SELECT status FROM gear_contact_messages').get().status,'sent');
  }finally{db.close();}
});

test('public contact route rejects unsafe boundaries and maps failures generically',async()=>{
  const id=crypto.randomUUID(),value=raw(id);let verifies=0,reserves=0;
  const handler=createContactHandler({verify:async()=>{verifies++;},reserve:async()=>{reserves++;return {limited:true};}}),env={GEAR_DB:{},GEAR_RESEND_API_KEY:'test_key',GEAR_CONTACT_ENABLED:'true'};
  const cases=[request(value,{url:'https://www.postandin.com/api/gear/contact'}),request(value,{headers:{Origin:'https://example.test'}}),new Request('https://postandin.com/api/gear/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),request(value,{headers:{'Content-Type':'text/plain'}}),request('{'),request({...value,extra:'x'.repeat(9000)}),request({...value,adult:false})];
  for(const [index,status] of [403,403,403,415,400,413,400].entries())assert.equal((await handler({request:cases[index],env})).status,status);
  assert.equal(verifies,0);assert.equal(reserves,0);
  assert.equal((await handler({request:request(value),env:{GEAR_DB:{},GEAR_RESEND_API_KEY:'test_key'}})).status,503);assert.equal(verifies,0);
  assert.equal((await createContactHandler({verify:async()=>{throw new GearTurnstileRejectedError();}})({request:request(value),env})).status,400);
  assert.equal((await createContactHandler({verify:async()=>{throw new GearTurnstileUnavailableError();}})({request:request(value),env})).status,503);
  const limited=await handler({request:request(value),env});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'600');
  assert.equal((await createContactHandler({verify:async()=>{},reserve:async()=>({unavailable:true})})({request:request(value),env})).status,404);
  assert.equal((await createContactHandler({verify:async()=>{},reserve:async()=>({conflict:true})})({request:request(value),env})).status,409);
  assert.equal((await createContactHandler({verify:async()=>{},reserve:async()=>({contact:{id:value.requestId,status:'pending'}}),claim:async()=>({claimed:true,token:crypto.randomUUID()}),release:async()=>true,deliver:async()=>{throw new GearContactMailUnavailableError('private');}})({request:request(value),env})).status,503);
});
