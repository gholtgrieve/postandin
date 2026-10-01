import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerActionHandler} from '../functions/api/gear/admin/actions.js';
import {createGearConfigHandler} from '../functions/api/gear/config.js';
import {createDraftSubmissionHandler} from '../functions/api/gear/drafts.js';
import {createVerificationConfirmHandler} from '../functions/api/gear/verification/confirm.js';
import {createVerificationRequestHandler} from '../functions/api/gear/verification/request.js';
import {productionAPI} from '../gear/production-api.mjs';
import {contactDeliveryConfigured,sendContactMessage} from '../lib/gear-contact-mail.mjs';
import {managementRequestError} from '../lib/gear-management-http.mjs';
import {sendManagementLink} from '../lib/gear-management-mail.mjs';
import {gearMailPolicyConfigured,gearMailRecipientAllowed} from '../lib/gear-mail-policy.mjs';
import {
  GEAR_PRODUCTION_ADMIN_ORIGIN,GEAR_PRODUCTION_PUBLIC_ORIGIN,
  GEAR_STAGING_ADMIN_ORIGIN,GEAR_STAGING_PUBLIC_ORIGIN,
  gearAdminOrigin,gearPublicOrigin,isGearAdminOrigin,isGearPublicOrigin,
} from '../lib/gear-origins.mjs';
import {createTurnstileVerifier,GearTurnstileRejectedError,GearTurnstileUnavailableError} from '../lib/gear-turnstile.mjs';
import {sendVerificationLink,verificationMailConfigured} from '../lib/gear-verification-mail.mjs';

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
  const mailConfig=await createGearConfigHandler()({request:new Request(GEAR_STAGING_PUBLIC_ORIGIN+'/api/gear/config'),env:{GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN,GEAR_TURNSTILE_SITE_KEY:'staging-site-key',GEAR_DB:{},GEAR_RESEND_API_KEY:'key',GEAR_CONTACT_ENABLED:'true'}});
  assert.equal((await mailConfig.json()).contactEnabled,false);
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
  const env={GEAR_RESEND_API_KEY:'key',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN,GEAR_STAGING_MAIL_RECIPIENTS:'seller@example.com'};
  await sendManagementLink({recipient:'seller@example.com',token:TOKEN},env,{fetcher});
  await sendVerificationLink({recipient:'seller@example.com',token:TOKEN},env,{fetcher});
  await sendContactMessage({id:RECEIPT_ID,recipient:'seller@example.com',buyerEmail:'buyer@example.com',buyerName:'Buyer',listingTitle:'Skates',message:'Are these available?'},env,{fetcher});
  assert.match(bodies[0].text,new RegExp(GEAR_STAGING_PUBLIC_ORIGIN.replaceAll('.','\\.')+'/gear/#management='));
  assert.match(bodies[1].text,new RegExp(GEAR_STAGING_PUBLIC_ORIGIN.replaceAll('.','\\.')+'/gear/#verification='));
  assert.deepEqual(bodies[2].to,['seller@example.com']);
  await assert.rejects(sendManagementLink({recipient:'seller@example.com',token:TOKEN},{...env,GEAR_PUBLIC_ORIGIN:'https://preview.pages.dev'},{fetcher}),error=>error.code==='config');
});

test('staging mail fails closed unless the recipient is explicitly allowlisted',async()=>{
  const base={GEAR_RESEND_API_KEY:'key',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN};
  assert.equal(gearMailPolicyConfigured(base),false);
  assert.equal(gearMailPolicyConfigured({...base,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'}),true);
  assert.equal(gearMailRecipientAllowed('allowed@example.com',{...base,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'}),true);
  assert.equal(gearMailRecipientAllowed('allowed@example.com',{...base,GEAR_STAGING_MAIL_RECIPIENTS:' Allowed@Example.com '}),true);
  assert.equal(verificationMailConfigured(base),false);
  assert.equal(contactDeliveryConfigured({...base,GEAR_CONTACT_ENABLED:'true'}),false);
  for(const value of ['',null,42,'allowed@example.com,allowed@example.com','allowed@example.com,Allowed@Example.com','allowed@example.com,','allowed@example.com\n','allowed@example.com\t','not-an-email','a'.repeat(4097)])assert.equal(gearMailPolicyConfigured({...base,GEAR_STAGING_MAIL_RECIPIENTS:value}),false);
  const fetcher=async()=>{throw new Error('mail provider must not be called');};
  await assert.rejects(sendManagementLink({recipient:'blocked@example.com',token:TOKEN},{...base,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'},{fetcher}),error=>error.code==='config');
  await assert.rejects(sendVerificationLink({recipient:'blocked@example.com',token:TOKEN},{...base,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'},{fetcher}),error=>error.code==='config'&&error.releasable);
  await assert.rejects(sendContactMessage({id:RECEIPT_ID,recipient:'blocked@example.com',buyerEmail:'buyer@example.com',buyerName:'Buyer',listingTitle:'Skates',message:'Are these available?'},{...base,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'},{fetcher}),error=>error.code==='config');
});

test('blocked staging verification releases the pre-delivery token without provider work',async()=>{
  let releases=0,fetches=0;
  const handler=createVerificationRequestHandler({
    configured:()=>true,
    issue:async()=>({recipient:'blocked@example.com',token:TOKEN}),
    release:async()=>{releases++;return true;},
    send:(receipt,env)=>sendVerificationLink(receipt,env,{fetcher:async()=>{fetches++;return Response.json({id:RECEIPT_ID});}}),
    now:()=>100,
  });
  const response=await handler({request:stagingRequest('/api/gear/verification/request',{id:RECEIPT_ID}),env:{GEAR_DB:{},GEAR_RESEND_API_KEY:'key',GEAR_PUBLIC_ORIGIN:GEAR_STAGING_PUBLIC_ORIGIN,GEAR_STAGING_MAIL_RECIPIENTS:'allowed@example.com'}});
  assert.equal(response.status,503);
  assert.equal(releases,1);
  assert.equal(fetches,0);
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
