import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEAR_ADMIN_HOST, GearAccessDeniedError, GearAccessUnavailableError,
  createGearAccessVerifier,
} from '../lib/gear-access.mjs';
import { createOwnerSessionHandler } from '../functions/api/gear/admin/session.js';

const NOW=1800000000000;
const TEAM_DOMAIN='https://sample-team.cloudflareaccess.com';
const AUDIENCE='gear-owner-audience';
const OWNER='owner@example.test';
const ENV={GEAR_ACCESS_TEAM_DOMAIN:TEAM_DOMAIN,GEAR_ACCESS_AUD:AUDIENCE,GEAR_OWNER_EMAILS:`other@example.test, ${OWNER.toUpperCase()}`};

const encode=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');

async function keyFixture(kid) {
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  return {kid,privateKey:pair.privateKey,jwk:{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'RS256',use:'sig'}};
}

const fixturesPromise=Promise.all([keyFixture('key-one'),keyFixture('key-two')]);

async function token(fixture,{header={},payload={}}={}) {
  const now=Math.floor(NOW/1000);
  const encodedHeader=encode({typ:'JWT',alg:'RS256',kid:fixture.kid,...header});
  const encodedPayload=encode({iss:TEAM_DOMAIN,aud:AUDIENCE,email:OWNER,sub:'owner-subject',iat:now-10,nbf:now-10,exp:now+300,...payload});
  const input=`${encodedHeader}.${encodedPayload}`;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',fixture.privateKey,new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

const request=jwt=>new Request(`https://${GEAR_ADMIN_HOST}/api/gear/admin/session`,{headers:{'Cf-Access-Jwt-Assertion':jwt}});
const jwksResponse=keys=>new Response(JSON.stringify({keys}),{headers:{'Content-Type':'application/json'}});

test('Access verifier accepts an allowlisted signed identity and briefly caches its key',async()=>{
  const [first]=await fixturesPromise;let fetches=0;
  const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async(url,options)=>{
    fetches++;assert.equal(url,`${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    assert.deepEqual(options,{headers:{Accept:'application/json'},redirect:'manual'});
    return jwksResponse([first.jwk]);
  }});
  const jwt=await token(first,{payload:{aud:['unrelated',AUDIENCE]}});
  assert.deepEqual(await verify(request(jwt),ENV),{email:OWNER,subject:'owner-subject'});
  assert.deepEqual(await verify(request(jwt),ENV),{email:OWNER,subject:'owner-subject'});
  assert.equal(fetches,1);
});

test('Access verifier refreshes cached JWKS once when a rotated kid appears',async()=>{
  const [first,second]=await fixturesPromise;let fetches=0;
  const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>jwksResponse(fetches++===0?[first.jwk]:[first.jwk,second.jwk])});
  await verify(request(await token(first)),ENV);
  await verify(request(await token(second)),ENV);
  assert.equal(fetches,2);
});

test('Access verifier refreshes expired keys and rate-limits repeated unknown kids',async()=>{
  const [first]=await fixturesPromise;let fetches=0,clock=NOW;
  const verify=createGearAccessVerifier({now:()=>clock,fetchImpl:async()=>{fetches++;return jwksResponse([first.jwk]);}});
  const valid=await token(first);
  await verify(request(valid),ENV);assert.equal(fetches,1);
  clock+=5*60*1000+1;await verify(request(valid),ENV);assert.equal(fetches,2);
  clock+=1000;
  const unknown=await token(first,{header:{kid:'unknown-key'}});
  await assert.rejects(verify(request(unknown),ENV),GearAccessDeniedError);assert.equal(fetches,3);
  await assert.rejects(verify(request(unknown),ENV),GearAccessDeniedError);assert.equal(fetches,3);
});

test('Access verifier rejects wrong host, transport, token structure and signatures',async()=>{
  const [first,second]=await fixturesPromise;
  const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>jwksResponse([first.jwk,second.jwk])});
  const valid=await token(first),parts=valid.split('.');
  const cases=[
    new Request(`https://postandin.com/api/gear/admin/session`,{headers:{'Cf-Access-Jwt-Assertion':valid}}),
    new Request(`http://${GEAR_ADMIN_HOST}/api/gear/admin/session`,{headers:{'Cf-Access-Jwt-Assertion':valid}}),
    new Request(`https://${GEAR_ADMIN_HOST}/api/gear/admin/session`),
    new Request(`https://${GEAR_ADMIN_HOST}/api/gear/admin/session`,{headers:{'Cf-Access-Authenticated-User-Email':OWNER}}),
    new Request(`https://${GEAR_ADMIN_HOST}/api/gear/admin/session`,{headers:{Cookie:`CF_Authorization=${valid}`}}),
    request('not-a-jwt'),
    request(parts.slice(0,2).join('.')),
    request(`${valid}.extra`),
    request(`${parts[0]}.${parts[1]}.${parts[2]}=`),
    request(`${encode([])}.${parts[1]}.${parts[2]}`),
    request('a'.repeat(16385)),
    request(await token(first,{header:{kid:undefined}})),
    request(await token(first,{header:{kid:'k'.repeat(257)}})),
    request(await token(first,{header:{alg:'HS256'}})),
    request(await token(first,{header:{crit:['exp']}})),
    request(await token(first,{header:{kid:'unknown-key'}})),
    request(`${parts[0]}.${encode({iss:TEAM_DOMAIN,aud:AUDIENCE,email:'intruder@example.test',exp:Math.floor(NOW/1000)+300})}.${parts[2]}`),
    request((await token(second)).replace(/^[^.]+/,encode({typ:'JWT',alg:'RS256',kid:first.kid}))),
  ];
  for(const candidate of cases)await assert.rejects(verify(candidate,ENV),GearAccessDeniedError);
});

test('Access verifier enforces issuer, audience, time and exact owner allowlist',async()=>{
  const [first]=await fixturesPromise;
  const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>jwksResponse([first.jwk])});
  const now=Math.floor(NOW/1000);
  const invalidPayloads=[
    {iss:'https://other.cloudflareaccess.com'},
    {aud:'another-audience'},
    {aud:['first','second']},
    {exp:undefined},
    {exp:now-31},
    {exp:'later'},
    {nbf:now+31},
    {nbf:'later'},
    {iat:now+31},
    {iat:1.5},
    {email:'intruder@example.test'},
    {email:'Kelly@example.test'},
    {email:` ${OWNER}`},
    {email:null},
  ];
  for(const payload of invalidPayloads)await assert.rejects(verify(request(await token(first,{payload})),ENV),GearAccessDeniedError);
  assert.equal((await verify(request(await token(first,{payload:{exp:now-29,nbf:now+30}})),ENV)).email,OWNER);
});

test('Access verifier fails unavailable for missing configuration or unusable JWKS',async()=>{
  const [first]=await fixturesPromise,jwt=await token(first);
  const environments=[
    {},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://example.com'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'http://sample-team.cloudflareaccess.com'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://a.b.cloudflareaccess.com'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://user@sample-team.cloudflareaccess.com'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://sample-team.cloudflareaccess.com/path'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://sample-team.cloudflareaccess.com?query=1'},
    {...ENV,GEAR_ACCESS_TEAM_DOMAIN:'https://sample-team.cloudflareaccess.com:8443'},
    {...ENV,GEAR_ACCESS_AUD:'bad audience'},
    {...ENV,GEAR_OWNER_EMAILS:''},
    {...ENV,GEAR_OWNER_EMAILS:'owner@example.test, malformed'},
    {...ENV,GEAR_OWNER_EMAILS:'Kelly@example.test'},
  ];
  for(const env of environments){
    const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>jwksResponse([first.jwk])});
    await assert.rejects(verify(request(jwt),env),GearAccessUnavailableError);
  }
  for(const fetchImpl of [
    async()=>new Response('failure',{status:500}),
    async()=>new Response(null,{status:302,headers:{Location:'https://example.com/keys'}}),
    async()=>jwksResponse([]),
    async()=>new Response('not json'),
    async()=>jwksResponse([{...first.jwk,kty:'EC'}]),
    async()=>jwksResponse(Array.from({length:17},(_,index)=>({...first.jwk,kid:`key-${index}`}))),
    async()=>{throw new Error('private network detail');},
  ]){
    const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl});
    await assert.rejects(verify(request(jwt),ENV),GearAccessUnavailableError);
  }
  const oversized=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>new Response('{}',{headers:{'Content-Length':'65537'}})});
  await assert.rejects(oversized(request(jwt),ENV),GearAccessUnavailableError);
  const streamedOversized=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>new Response(new Uint8Array(65537))});
  await assert.rejects(streamedOversized(request(jwt),ENV),GearAccessUnavailableError);
});

test('owner session probe returns only generic no-store outcomes',async()=>{
  const [first]=await fixturesPromise;
  const headers=response=>{
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  };
  const verify=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>jwksResponse([first.jwk])});
  const success=await createOwnerSessionHandler(verify)({request:request(await token(first)),env:ENV});
  assert.equal(success.status,200);headers(success);assert.deepEqual(await success.json(),{authenticated:true});
  const denied=await createOwnerSessionHandler(async()=>{throw new GearAccessDeniedError();})({request:new Request(`https://${GEAR_ADMIN_HOST}/`),env:{}});
  assert.equal(denied.status,403);headers(denied);assert.deepEqual(await denied.json(),{error:'Access denied.'});
  const original=console.error,errors=[];console.error=(...args)=>errors.push(args);
  try{
    const realDenied=await createOwnerSessionHandler(verify)({request:request(await token(first,{payload:{aud:'wrong'}})),env:ENV});
    assert.equal(realDenied.status,403);headers(realDenied);assert.deepEqual(await realDenied.json(),{error:'Access denied.'});
    const failedKeys=createGearAccessVerifier({now:()=>NOW,fetchImpl:async()=>new Response('failure',{status:500})});
    const realUnavailable=await createOwnerSessionHandler(failedKeys)({request:request(await token(first)),env:ENV});
    assert.equal(realUnavailable.status,503);headers(realUnavailable);assert.deepEqual(await realUnavailable.json(),{error:'Owner access is temporarily unavailable.'});
    const unavailable=await createOwnerSessionHandler(async()=>{throw new GearAccessUnavailableError();})({request:new Request(`https://${GEAR_ADMIN_HOST}/`),env:{}});
    assert.equal(unavailable.status,503);headers(unavailable);assert.deepEqual(await unavailable.json(),{error:'Owner access is temporarily unavailable.'});
    const unexpected=await createOwnerSessionHandler(async()=>{throw new Error('private verifier detail');})({request:new Request(`https://${GEAR_ADMIN_HOST}/`),env:{}});
    assert.equal(unexpected.status,403);headers(unexpected);assert.deepEqual(await unexpected.json(),{error:'Access denied.'});
    assert.equal(errors.length,3);assert.match(String(errors[2][1]),/private verifier detail/);
  }finally{console.error=original;}
});
