import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionAPI} from '../gear/production-api.mjs';

const ORIGIN='https://postandin.com',ID='00000000-0000-4000-8000-000000000010',REQUEST_ID='00000000-0000-4000-8000-000000000011';
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const input=token=>({id:ID,requestId:REQUEST_ID,name:'Buyer',email:'buyer@example.test',message:'Is this available?',turnstileToken:token});

test('production contact adapter posts the exact private payload and validates success',async()=>{
  const calls=[],api=productionAPI({origin:ORIGIN,fetcher:async(url,options)=>{calls.push({url,options});return json(202,{ok:true,message:'Message accepted for delivery.'});}});
  assert.deepEqual(await api.contact(input('contact-token')),{ok:true,message:'Message accepted for delivery.'});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/gear/contact');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.deepEqual(JSON.parse(calls[0].options.body),input('contact-token'));
  const malformed=productionAPI({origin:ORIGIN,fetcher:async()=>json(202,{ok:true})});await assert.rejects(malformed.contact(input('token')),/unreadable response/);
});

test('production contact adapter preserves retry instructions and a caller-owned request id',async()=>{
  const bodies=[];let attempt=0;const api=productionAPI({origin:ORIGIN,fetcher:async(_url,options)=>{bodies.push(JSON.parse(options.body));return ++attempt===1?json(503,{error:'This contact request is already being processed. Wait and try again.'},{'Retry-After':'60'}):json(202,{ok:true,message:'Message accepted for delivery.'});}});
  await assert.rejects(api.contact(input('first-token')),error=>error.safe&&error.status===503&&error.retryAfter===60);
  await api.contact(input('fresh-token'));
  assert.equal(bodies[0].requestId,REQUEST_ID);assert.equal(bodies[1].requestId,REQUEST_ID);assert.notEqual(bodies[0].turnstileToken,bodies[1].turnstileToken);
});

test('production contact UI is config-gated and uses its dedicated Turnstile action',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8'),html=readFileSync(new URL('../gear/index.html',import.meta.url),'utf8');
  assert.match(source,/contactAvailable=config\.contactEnabled/);assert.match(source,/action:'gear-contact'/);assert.match(source,/contactRequestId=contactRequestId\|\|crypto\.randomUUID\(\)/);assert.match(source,/error\.status===404\|\|error\.status===409/);assert.match(source,/contactRetryLocked=true/);assert.match(source,/Send same message again/);
  assert.match(html,/id="pi-contact-turnstile" hidden/);assert.match(html,/id="pi-contact-turnstile-status"/);assert.doesNotMatch(html,/id="pi-buyer-adult"/);assert.doesNotMatch(html,/id="pi-buyer-share"/);
});
