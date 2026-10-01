import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerActionHandler} from '../functions/api/gear/admin/actions.js';
import {createGearConfigHandler} from '../functions/api/gear/config.js';
import {createDraftSubmissionHandler} from '../functions/api/gear/drafts.js';
import {createVerificationConfirmHandler} from '../functions/api/gear/verification/confirm.js';
import {createVerificationRequestHandler} from '../functions/api/gear/verification/request.js';
import {productionAPI} from '../gear/production-api.mjs';
import {managementRequestError} from '../lib/gear-management-http.mjs';
import {sendManagementLink} from '../lib/gear-management-mail.mjs';
import {
  GEAR_PRODUCTION_ADMIN_ORIGIN,GEAR_PRODUCTION_PUBLIC_ORIGIN,
  GEAR_STAGING_ADMIN_ORIGIN,GEAR_STAGING_PUBLIC_ORIGIN,
  gearAdminOrigin,gearPublicOrigin,isGearAdminOrigin,isGearPublicOrigin,
} from '../lib/gear-origins.mjs';
import {createTurnstileVerifier,GearTurnstileRejectedError,GearTurnstileUnavailableError} from '../lib/gear-turnstile.mjs';
import {sendVerificationLink} from '../lib/gear-verification-mail.mjs';

const TOKEN='a'.repeat(64),RECEIPT_ID='00000000-0000-4000-8000-000000000001';
const DRAFT={title:'Club bag',description:'Worn zipper.',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'One size',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const stagingRequest=(path,body)=>new Request(GEAR_STAGING_PUBLIC_ORIGIN+path,{method:'POST',headers:{Origin:GEAR_STAGING_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('origin configuration defaults to production and allows only the fixed staging hosts',()=>{
  assert.equal(gearPublicOrigin({}),GEAR_PRODUCTION_PUBLIC_ORIGIN);
  assert.equal(gearAdminOrigin({}),GEAR_PRODUCTION_ADMIN_ORIGIN);
  assert.equal(gearPublicOrigin({GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN}),GEAR_STAGING_PUBLIC_ORIGIN);
  assert.equal(gearAdminOrigin({GEAR_ADMIN_ORIGIN:GEAR_STAGING_ADMIN_ORIGIN}),GEAR_STAGING_ADMIN_ORIGIN);
  for(const value of ['',GEAR_STAGING_PUBLIC_ORIGIN+'/', 'https://preview.pages.dev'])assert.equal(gearPublicOrigin({GEAR_PUBLIC_ORIGIN:value}),null);
  assert.equal(gearAdminOrigin({GEAR_ADMIN_ORIGIN:'https://postandin-gear-staging.pages.dev'}),null);
  assert.equal(isGearPublicOrigin(GEAR_STAGING_PUBLIC_ORIGIN),true);
  assert.equal(isGearAdminOrigin(GEAR_STAGING_ADMIN_ORIGIN),true);
});

test('staging public origin is accepted across browser, config and management boundaries',async()=>{
  assert.doesNotThrow(()=>productionAPI({origin:GEAR_STAGING_PUBLIC_ORIGIN,fetcher:async()=>Response.json({})}));
  const request=new Request(GEAR_STAGING_PUBLIC_ORIGIN+'/api/gear/management/session',{method:'POST',headers:{Origin:GEAR_STAGING_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:'{}'});
  assert.equal(managementRequestError(request,{GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN}),null);
  assert.equal(managementRequestError(request,{GEAR_PUBLIC_ORIGIN:'https://preview.pages.dev'}).status,403);
  const productionRequest=new Request(GEAR_PRODUCTION_PUBLIC_ORIGIN+'/api/gear/management/session',{method:'POST',headers:{Origin:GEAR_PRODUCTION_PUBLIC_ORIGIN,'Content-Type':'application/json'},body:'{}'});
  assert.equal(managementRequestError(productionRequest,{GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN}).status,403);
  const response=await createGearConfigHandler()({request:new Request(GEAR_STAGING_PUBLIC_ORIGIN+'/api/gear/config'),env:{GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN,GEAR_TURNSTILE_SITE_KEY:'staging-site-key'}});
  assert.equal(response.status,200);
});

test('staging posting and verification routes pass environment-aware origin checks',async()=>{
  const env={GEAR_DB:{},GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN};let calls=0;
  const draft=createDraftSubmissionHandler({verify:async()=>{},create:async()=>{calls++;return {id:'draft'};}});
  assert.equal((await draft({request:stagingRequest('/api/gear/drafts',{listing:DRAFT,turnstileToken:'token'}),env})).status,201);
  const request=createVerificationRequestHandler({configured:()=>true,issue:async()=>{calls++;return null;}});
  assert.equal((await request({request:stagingRequest('/api/gear/verification/request',{id:'00000000-0000-4000-8000-000000000001'}),env})).status,404);
  const confirm=createVerificationConfirmHandler({confirm:async()=>{calls++;return {verified:false};}});
  assert.equal((await confirm({request:stagingRequest('/api/gear/verification/confirm',{token:TOKEN,confirm:true}),env})).status,400);
  assert.equal(calls,3);
  const invalidEnv={...env,GEAR_PUBLIC_ORIGIN:'https://preview.pages.dev'};
  assert.equal((await draft({request:stagingRequest('/api/gear/drafts',{listing:DRAFT,turnstileToken:'token'}),env:invalidEnv})).status,403);
  assert.equal((await request({request:stagingRequest('/api/gear/verification/request',{id:'00000000-0000-4000-8000-000000000001'}),env:invalidEnv})).status,403);
  assert.equal((await confirm({request:stagingRequest('/api/gear/verification/confirm',{token:TOKEN,confirm:true}),env:invalidEnv})).status,403);
  assert.equal(calls,3);
});

test('staging Turnstile verification derives the exact configured hostname',async()=>{
  const verifier=createTurnstileVerifier({expectedAction:'gear-post',fetchImpl:async()=>Response.json({success:true,hostname:'postandin-gear-staging.pages.dev',action:'gear-post'})});
  await verifier('token',{GEAR_TURNSTILE_SECRET:'secret',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN});
  const wrong=createTurnstileVerifier({expectedAction:'gear-post',fetchImpl:async()=>Response.json({success:true,hostname:'postandin.com',action:'gear-post'})});
  await assert.rejects(wrong('token',{GEAR_TURNSTILE_SECRET:'secret',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN}),error=>error instanceof GearTurnstileRejectedError&&error.diagnostic);
  await assert.rejects(verifier('token',{GEAR_TURNSTILE_SECRET:'secret',GEAR_PUBLIC_ORIGIN:'https://preview.pages.dev'}),GearTurnstileUnavailableError);
});

test('staging mail links point only to the approved staging public origin',async()=>{
  const bodies=[];const fetcher=async(_url,options)=>{bodies.push(JSON.parse(options.body));return Response.json({id:RECEIPT_ID});};
  const env={GEAR_RESEND_API_KEY:'key',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN};
  await sendManagementLink({recipient:'seller@example.com',token:TOKEN},env,{fetcher});
  await sendVerificationLink({recipient:'seller@example.com',token:TOKEN},env,{fetcher});
  assert.match(bodies[0].text,new RegExp(GEAR_STAGING_PUBLIC_ORIGIN.replaceAll('.','\\.')+'/gear/#management='));
  assert.match(bodies[1].text,new RegExp(GEAR_STAGING_PUBLIC_ORIGIN.replaceAll('.','\\.')+'/gear/#verification='));
  await assert.rejects(sendManagementLink({recipient:'seller@example.com',token:TOKEN},{...env,GEAR_PUBLIC_ORIGIN:'https://preview.pages.dev'},{fetcher}),error=>error.code==='config');
});

test('staging admin actions require the fixed staging admin origin',async()=>{
  let verified=0;
  const handler=createOwnerActionHandler({verify:async()=>{verified++;return {email:'owner@example.com'};},moderate:async()=>true});
  const request=origin=>new Request(origin+'/api/gear/admin/actions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await handler({request:request(GEAR_STAGING_ADMIN_ORIGIN),env:{GEAR_ADMIN_ORIGIN:GEAR_STAGING_ADMIN_ORIGIN}})).status,400);
  assert.equal(verified,1);
  assert.equal((await handler({request:request(GEAR_STAGING_ADMIN_ORIGIN),env:{GEAR_ADMIN_ORIGIN:'https://preview.pages.dev'}})).status,403);
  assert.equal(verified,1);
});
