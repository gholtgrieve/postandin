import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGearConfigHandler} from '../functions/api/gear/config.js';
import * as configRoute from '../functions/api/gear/config.js';
import {draftListingInput,productionAPI,takeVerificationToken} from '../gear/production-api.mjs';
import {loadProductionTurnstile,TURNSTILE_SCRIPT_URL,validTurnstileSiteKey} from '../gear/production-turnstile.mjs';

const ORIGIN='https://postandin.com',TOKEN='a'.repeat(64),SITE_KEY='1x00000000000000000000AA';
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});

test('verification fragment is synchronously erased and strictly parsed',()=>{
  const calls=[],history={state:{kept:true},replaceState(...args){calls.push(args);}};
  assert.equal(takeVerificationToken({hash:'#verification='+TOKEN,pathname:'/gear/',search:'?source=email'},history),TOKEN);
  assert.deepEqual(calls,[[history.state,'','/gear/?source=email']]);
  assert.equal(takeVerificationToken({hash:'#verification=BAD',pathname:'/gear/',search:''},history),null);
  assert.deepEqual(calls.at(-1),[history.state,'','/gear/']);
  const count=calls.length;assert.equal(takeVerificationToken({hash:'#management='+TOKEN,pathname:'/gear/',search:''},history),null);assert.equal(calls.length,count);
});

test('public posting config is canonical, no-store and fails closed without a valid site key',async()=>{
  const handler=createGearConfigHandler(),run=(url=ORIGIN+'/api/gear/config',env={},headers={})=>handler({request:new Request(url,{headers}),env});
  assert.equal((await run('https://preview.pages.dev/api/gear/config',{GEAR_TURNSTILE_SITE_KEY:SITE_KEY})).status,403);
  assert.equal((await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await run()).status,503);assert.equal((await run(undefined,{GEAR_TURNSTILE_SITE_KEY:'bad key'})).status,503);
  let response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:' '+SITE_KEY+' '});assert.equal(response.status,200);assert.deepEqual(await response.json(),{turnstileSiteKey:SITE_KEY,contactEnabled:false,reportEnabled:false});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  for(const value of ['TRUE','1',' true']){response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,GEAR_CONTACT_ENABLED:value,GEAR_RESEND_API_KEY:'test_key',GEAR_DB:{}});assert.equal((await response.json()).contactEnabled,false);}
  response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,GEAR_CONTACT_ENABLED:'true',GEAR_RESEND_API_KEY:'test_key'});assert.equal((await response.json()).contactEnabled,false);
  response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,GEAR_CONTACT_ENABLED:'true',GEAR_DB:{}});assert.equal((await response.json()).contactEnabled,false);
  response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,GEAR_CONTACT_ENABLED:'true',GEAR_RESEND_API_KEY:'test_key',GEAR_DB:{}});assert.deepEqual(await response.json(),{turnstileSiteKey:SITE_KEY,contactEnabled:true,reportEnabled:false});
  for(const env of [{GEAR_REPORTS_ENABLED:'true',GEAR_TURNSTILE_SECRET:'test-secret'},{GEAR_REPORTS_ENABLED:'true',GEAR_DB:{}},...['TRUE',' true','1','yes'].map(GEAR_REPORTS_ENABLED=>({GEAR_REPORTS_ENABLED,GEAR_TURNSTILE_SECRET:'test-secret',GEAR_DB:{}})),...['','   ','bad secret',`x`.repeat(513)].map(GEAR_TURNSTILE_SECRET=>({GEAR_REPORTS_ENABLED:'true',GEAR_TURNSTILE_SECRET,GEAR_DB:{}}))]){response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,...env});assert.equal((await response.json()).reportEnabled,false);}
  response=await run(undefined,{GEAR_TURNSTILE_SITE_KEY:SITE_KEY,GEAR_REPORTS_ENABLED:'true',GEAR_TURNSTILE_SECRET:'test-secret',GEAR_DB:{}});assert.equal((await response.json()).reportEnabled,true);
  assert.deepEqual(Object.keys(configRoute).filter(key=>key.startsWith('onRequest')),['onRequestGet']);
});

test('production posting adapter uses bounded same-origin requests and preserves Retry-After',async()=>{
  const calls=[];let requests=0;const api=productionAPI({origin:ORIGIN,fetcher:async(url,options)=>{calls.push({url,options});if(url==='/api/gear/config')return json(200,{turnstileSiteKey:SITE_KEY,contactEnabled:false,reportEnabled:false});if(url.endsWith('/verification/request'))return ++requests===1?json(202,{message:'Verification email accepted for delivery.'}):new Response('<h1>limited</h1>',{status:429,headers:{'Retry-After':'42','Content-Type':'text/html'}});return json(url.endsWith('/drafts')?201:200,url.endsWith('/drafts')?{id:'00000000-0000-4000-8000-000000000001',status:'unverified',photoToken:TOKEN}:{verified:true,listingId:'00000000-0000-4000-8000-000000000001'});}});
  assert.deepEqual(await api.config(),{turnstileSiteKey:SITE_KEY,contactEnabled:false,reportEnabled:false});
  const listing={title:'Bag'};await api.createDraft(listing,'turnstile-token');
  assert.deepEqual(await api.requestVerification('00000000-0000-4000-8000-000000000001'),{message:'Verification email accepted for delivery.'});
  await assert.rejects(api.requestVerification('00000000-0000-4000-8000-000000000001'),error=>error.safe&&error.status===429&&error.retryAfter===42&&/Too many requests/.test(error.message));
  await api.confirmVerification(TOKEN);
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.deepEqual(JSON.parse(calls[1].options.body),{listing,turnstileToken:'turnstile-token'});assert.deepEqual(JSON.parse(calls[2].options.body),{id:'00000000-0000-4000-8000-000000000001'});assert.deepEqual(JSON.parse(calls[3].options.body),{id:'00000000-0000-4000-8000-000000000001'});assert.deepEqual(JSON.parse(calls[4].options.body),{token:TOKEN,confirm:true});
  for(const call of calls.slice(1)){assert.equal(call.options.method,'POST');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');}
});

test('posting adapter rejects malformed success shapes and bounds server errors',async()=>{
  const malformed=productionAPI({origin:ORIGIN,fetcher:async()=>json(202,{})});await assert.rejects(malformed.requestVerification('00000000-0000-4000-8000-000000000001'),/unreadable response/);
  const nonJson=productionAPI({origin:ORIGIN,fetcher:async()=>new Response('<html>',{status:200,headers:{'Content-Type':'text/html'}})});await assert.rejects(nonJson.requestVerification('00000000-0000-4000-8000-000000000001'),error=>error.safe&&error.status===0&&/unreadable response/.test(error.message));
  const oversize=productionAPI({origin:ORIGIN,fetcher:async()=>new Response('x'.repeat(65537),{status:200})});await assert.rejects(oversize.requestVerification('00000000-0000-4000-8000-000000000001'),error=>error.safe&&error.status===0&&/unreadable response/.test(error.message));
  const unavailable=productionAPI({origin:ORIGIN,fetcher:async()=>new Response('gateway',{status:522})});await assert.rejects(unavailable.requestVerification('00000000-0000-4000-8000-000000000001'),error=>error.safe&&error.status===522&&/temporarily unavailable/.test(error.message));
  const bounded=productionAPI({origin:ORIGIN,fetcher:async()=>json(400,{error:{private:true},fields:{title:'x'.repeat(301),city:'Use a city.'}})});await assert.rejects(bounded.createDraft({},'token'),error=>error.safe&&error.status===400&&error.message==='Unable to complete this request.'&&error.fields.city==='Use a city.'&&!Object.hasOwn(error.fields,'title'));
});

test('draft projection includes seller verification fields but excludes browser-only data',()=>{
  const result=draftListingInput({title:'Bag',description:'Good bag',category:'Bundles',size:'Junior',fit:'Junior',condition:'Used — good',city:'Seattle',type:'Sale',priceCents:1200,trade:null,clubs:[],otherClub:'',seller:'Alex',email:'seller@example.test',photos:[{name:'private.jpg'}]},true);
  assert.equal(result.sellerName,'Alex');assert.equal(result.email,'seller@example.test');assert.equal(result.adult,true);assert.equal(Object.hasOwn(result,'photos'),false);assert.equal(Object.hasOwn(result,'seller'),false);
});

test('posting flow keeps photos in the main path and handles draft upload retries clearly',()=>{
  const html=readFileSync(new URL('../gear/index.html',import.meta.url),'utf8');
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../gear/gear.css',import.meta.url),'utf8');
  assert.match(html,/id="pi-photo-files"[^>]+multiple/);
  assert.match(html,/id="pi-post-photos"/);
  assert.doesNotMatch(html,/id="pi-adult"/);
  assert.match(html,/id="pi-post-submit">Send verification email/);
  assert.ok(html.indexOf('id="pi-post-seller"')<html.indexOf('id="pi-next-photos"'));
  assert.ok(html.indexOf('id="pi-post-turnstile"')<html.indexOf('id="pi-next-photos"'));
  assert.match(source,/async function prepareProductionDraftForPhotos/);
  assert.match(source,/api\.updateDraft\(localDraftId,localDraftPhotoToken,input\)/);
  assert.match(source,/api\.removeDraftPhoto\(localDraftId,localDraftPhotoToken,p\.id\)/);
  assert.match(source,/api\.reorderDraftPhotos\(localDraftId,localDraftPhotoToken,postPhotos\.map\(photo=>photo\.id\)\)/);
  assert.match(source,/postPhotos\.filter\(photo=>photo\.uploaded&&photo\.id\)\.map\(photo=>photo\.id\)/);
  assert.match(source,/This draft expired\. Your details and selected photos are still here/);
  assert.match(source,/postPhotos\.forEach\(photo=>\{if\(photo\.file\)photo\.uploaded=false;\}\)/);
  assert.match(source,/#pi-post-photos'\)\.hidden=Boolean\(connectedMode&&editingId\)/);
  assert.match(source,/status\.classList\.remove\('is-busy'\);status\.classList\.add\('is-error'\)/);
  assert.match(source,/return '#pi-draft-upload-status'/);
  assert.match(source,/Check your email for a management link and save that message for future use/);
  assert.doesNotMatch(html,/id="pi-review-status"/);
  assert.match(source,/data-review-photo/);
  assert.match(source,/Verify \$\{d\.email\} to publish for 30 days/);
  assert.match(source,/notFoundExpires:true/);
  assert.match(html,/id="pi-verify-back" data-post-back="1"/);
  assert.doesNotMatch(source,/This saved draft can request another email without a new privacy check/);
  assert.match(styles,/button:disabled\{cursor:not-allowed;opacity:\.5\}/);
  assert.match(styles,/\.pi-manage \.pi-seller-heading\{/);
});

test('Turnstile loader is configuration-gated and loads the exact explicit-render script',async()=>{
  assert.equal(validTurnstileSiteKey(SITE_KEY),true);assert.equal(validTurnstileSiteKey('bad key'),false);
  await assert.rejects(loadProductionTurnstile({siteKey:'bad key',documentValue:{},windowValue:{}}),/unavailable/);
  const listeners=new Map(),script={dataset:{},addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);}};
  const client={render(){return 'widget';},reset(){}};const windowValue={};let appended;
  const documentValue={querySelector(){return null;},createElement(tag){assert.equal(tag,'script');return script;},head:{append(value){appended=value;queueMicrotask(()=>{windowValue.turnstile=client;listeners.get('load')();});}}};
  assert.equal(await loadProductionTurnstile({siteKey:SITE_KEY,documentValue,windowValue,timeoutMs:100}),client);assert.equal(appended,script);assert.equal(script.src,TURNSTILE_SCRIPT_URL);assert.equal(script.async,true);assert.equal(script.defer,true);assert.equal(script.referrerPolicy,'no-referrer');assert.equal(script.dataset.gearTurnstile,'true');assert.equal(listeners.size,0);
  assert.equal(await loadProductionTurnstile({siteKey:SITE_KEY,documentValue:{querySelector(){throw new Error('must not inspect');}},windowValue}),client);
});

test('Turnstile loader fails closed on script errors, unusable globals and timeouts',async()=>{
  const run=async mode=>{const listeners=new Map(),script={dataset:{},addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name,callback){if(listeners.get(name)===callback)listeners.delete(name);}};const documentValue={querySelector(){return null;},createElement(){return script;},head:{append(){if(mode==='error')queueMicrotask(()=>listeners.get('error')());if(mode==='unusable')queueMicrotask(()=>listeners.get('load')());}}};await assert.rejects(loadProductionTurnstile({siteKey:SITE_KEY,documentValue,windowValue:{},timeoutMs:5}),/unavailable/);assert.equal(listeners.size,0);};
  await run('error');await run('unusable');await run('timeout');
});
