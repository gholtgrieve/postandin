import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionAPI} from '../gear/production-api.mjs';

const ORIGIN='https://postandin.com',ID='00000000-0000-4000-8000-000000000010';
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});

test('production report adapter posts the bounded public payload and validates success',async()=>{
  const calls=[],api=productionAPI({origin:ORIGIN,fetcher:async(url,options)=>{calls.push({url,options});return json(201,{ok:true,message:'Report submitted for review.'});}}),input={id:ID,reason:'Other concern',turnstileToken:'report-token'};
  assert.deepEqual(await api.report(input),{ok:true,message:'Report submitted for review.'});assert.equal(calls[0].url,'/api/gear/reports');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.credentials,'same-origin');assert.deepEqual(JSON.parse(calls[0].options.body),input);
  await assert.rejects(productionAPI({origin:ORIGIN,fetcher:async()=>json(201,{ok:true})}).report(input),/unreadable response/);
  await assert.rejects(productionAPI({origin:ORIGIN,fetcher:async()=>json(429,{error:'Wait before reporting again.'},{'Retry-After':'42'})}).report(input),error=>error.safe&&error.status===429&&error.retryAfter===42&&error.message==='Wait before reporting again.');
  await assert.rejects(productionAPI({origin:ORIGIN,fetcher:async()=>{throw new Error('private network detail');}}).report(input),error=>error.safe&&error.status===0&&/could not be confirmed/.test(error.message)&&!error.message.includes('private'));
});

test('production report UI is config-gated and uses an isolated Turnstile action',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8'),html=readFileSync(new URL('../gear/index.html',import.meta.url),'utf8');assert.match(source,/reportAvailable=config\.reportEnabled/);assert.match(source,/action:'gear-report'/);assert.match(source,/api\.report\(\{id:state\.selected,reason:/);assert.match(html,/id="pi-report-turnstile" hidden/);assert.match(html,/id="pi-report-turnstile-status"/);
});
