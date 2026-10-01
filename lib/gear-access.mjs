import {GEAR_PRODUCTION_ADMIN_ORIGIN,gearAdminOrigin} from './gear-origins.mjs';

export const GEAR_ADMIN_HOST = new URL(GEAR_PRODUCTION_ADMIN_ORIGIN).host;

const JWT_MAX_BYTES = 16 * 1024;
const JWKS_MAX_BYTES = 64 * 1024;
const JWKS_CACHE_MS = 5 * 60 * 1000;
const FORCED_REFRESH_COOLDOWN_MS = 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 30;
const TEAM_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export class GearAccessDeniedError extends Error {
  constructor() { super('Gear owner access denied.');this.name='GearAccessDeniedError'; }
}
export class GearAccessUnavailableError extends Error {
  constructor(message='Gear owner access is unavailable.',options) { super(message,options);this.name='GearAccessUnavailableError'; }
}

const denied=()=>new GearAccessDeniedError();
const unavailable=(message,cause)=>new GearAccessUnavailableError(message,cause===undefined?undefined:{cause});

function configured(env) {
  const rawDomain=typeof env?.GEAR_ACCESS_TEAM_DOMAIN==='string'?env.GEAR_ACCESS_TEAM_DOMAIN.trim():'';
  const audience=typeof env?.GEAR_ACCESS_AUD==='string'?env.GEAR_ACCESS_AUD.trim():'';
  const rawOwners=typeof env?.GEAR_OWNER_EMAILS==='string'?env.GEAR_OWNER_EMAILS:'';
  let domain;
  try {domain=new URL(rawDomain);} catch {throw unavailable('Invalid Gear Access team domain configuration.');}
  if(domain.protocol!=='https:'||domain.username||domain.password||domain.port||domain.pathname!=='/'||domain.search||domain.hash||!TEAM_HOST.test(domain.hostname)) {
    throw unavailable('Invalid Gear Access team domain configuration.');
  }
  if(!audience||audience.length>512||/[\u0000-\u001f\u007f\s]/u.test(audience))throw unavailable('Invalid Gear Access audience configuration.');
  const owners=rawOwners.split(',').map(value=>value.trim()).filter(Boolean);
  if(!owners.length||owners.some(email=>email.length>254||!PRINTABLE_ASCII.test(email)||!EMAIL.test(email)))throw unavailable('Invalid Gear owner allowlist configuration.');
  const normalizedOwners=owners.map(email=>email.toLowerCase());
  return {teamDomain:domain.origin,audience,owners:new Set(normalizedOwners)};
}

function bytes(part,maxBytes=JWT_MAX_BYTES) {
  if(typeof part!=='string'||!part.length||part.length>maxBytes*2||!BASE64URL.test(part))throw denied();
  let binary;
  try {
    const base64=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=');
    binary=atob(base64);
  } catch {throw denied();}
  if(binary.length>maxBytes)throw denied();
  return Uint8Array.from(binary,character=>character.charCodeAt(0));
}

function objectPart(part) {
  let value;
  try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(part)));}
  catch(error) {if(error instanceof GearAccessDeniedError)throw error;throw denied();}
  if(!value||typeof value!=='object'||Array.isArray(value))throw denied();
  return value;
}

async function boundedJson(response) {
  if(!response?.ok||!response.body)throw unavailable('Unable to load Gear Access signing keys.');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>JWKS_MAX_BYTES)throw unavailable('Gear Access signing keys response is too large.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let total=0,text='';
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>JWKS_MAX_BYTES){await reader.cancel();throw unavailable('Gear Access signing keys response is too large.');}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } catch(error) {
    if(error instanceof GearAccessUnavailableError)throw error;
    throw unavailable('Unable to read Gear Access signing keys.',error);
  } finally {reader.releaseLock();}
  try {return JSON.parse(text);} catch(error) {throw unavailable('Invalid Gear Access signing keys response.',error);}
}

function validKeys(value) {
  if(!value||typeof value!=='object'||!Array.isArray(value.keys)||value.keys.length<1||value.keys.length>16) {
    throw unavailable('Invalid Gear Access signing keys response.');
  }
  const keys=value.keys.filter(key=>key&&typeof key==='object'&&typeof key.kid==='string'&&key.kid.length>0&&key.kid.length<=256);
  if(!keys.length)throw unavailable('Invalid Gear Access signing keys response.');
  return keys;
}

function matchingAudience(claim,audience) {
  return typeof claim==='string'?claim===audience:Array.isArray(claim)&&claim.some(value=>value===audience);
}

function validateClaims(payload,config,nowMilliseconds) {
  const now=Math.floor(nowMilliseconds/1000);
  if(payload.iss!==config.teamDomain||!matchingAudience(payload.aud,config.audience))throw denied();
  if(!Number.isSafeInteger(payload.exp)||payload.exp<=now-CLOCK_TOLERANCE_SECONDS)throw denied();
  if(payload.nbf!==undefined&&(!Number.isSafeInteger(payload.nbf)||payload.nbf>now+CLOCK_TOLERANCE_SECONDS))throw denied();
  if(payload.iat!==undefined&&(!Number.isSafeInteger(payload.iat)||payload.iat>now+CLOCK_TOLERANCE_SECONDS))throw denied();
  if(typeof payload.email!=='string')throw denied();
  if(payload.email.length>254||!PRINTABLE_ASCII.test(payload.email)||!EMAIL.test(payload.email))throw denied();
  const email=payload.email.toLowerCase();
  if(!config.owners.has(email))throw denied();
  return Object.freeze({email,subject:typeof payload.sub==='string'?payload.sub:null});
}

export function createGearAccessVerifier({fetchImpl=globalThis.fetch,subtle=globalThis.crypto?.subtle,now=Date.now,cacheTtlMs=JWKS_CACHE_MS}={}) {
  if(typeof fetchImpl!=='function'||!subtle||typeof now!=='function'||!Number.isFinite(cacheTtlMs)||cacheTtlMs<0) {
    throw new TypeError('Invalid Gear Access verifier dependency.');
  }
  const cache=new Map();
  async function refresh(teamDomain) {
    let response;
    try {response=await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`,{headers:{Accept:'application/json'},redirect:'manual'});}
    catch(error) {throw unavailable('Unable to load Gear Access signing keys.',error);}
    const keys=validKeys(await boundedJson(response));
    const prior=cache.get(teamDomain);
    const entry={keys,expiresAt:now()+cacheTtlMs,lastForcedRefreshAt:prior?.lastForcedRefreshAt??null};
    if(cache.size>=4&&!cache.has(teamDomain))cache.clear();
    cache.set(teamDomain,entry);
    return entry;
  }
  async function signingKey(teamDomain,kid) {
    let entry=cache.get(teamDomain),refreshed=false;
    if(!entry||entry.expiresAt<=now()){entry=await refresh(teamDomain);refreshed=true;}
    let jwk=entry.keys.find(key=>key.kid===kid);
    if(!jwk&&refreshed){entry.lastForcedRefreshAt=now();}
    if(!jwk&&!refreshed){
      const refreshAt=now();
      if(entry.lastForcedRefreshAt!==null&&refreshAt-entry.lastForcedRefreshAt<FORCED_REFRESH_COOLDOWN_MS)throw denied();
      entry.lastForcedRefreshAt=refreshAt;
      entry=await refresh(teamDomain);jwk=entry.keys.find(key=>key.kid===kid);
    }
    if(!jwk)throw denied();
    if(jwk.kty!=='RSA'||typeof jwk.n!=='string'||typeof jwk.e!=='string'||(jwk.alg!==undefined&&jwk.alg!=='RS256')||(jwk.use!==undefined&&jwk.use!=='sig')) {
      throw unavailable('Invalid Gear Access signing key.');
    }
    try {return await subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);}
    catch(error) {throw unavailable('Unable to import Gear Access signing key.',error);}
  }
  return async function verifyGearOwnerAccess(request,env) {
    let requestUrl;
    try {requestUrl=new URL(request?.url);} catch {throw denied();}
    const adminOrigin=gearAdminOrigin(env);
    if(!adminOrigin||requestUrl.origin!==adminOrigin)throw denied();
    const config=configured(env);
    const token=request.headers.get('cf-access-jwt-assertion');
    if(!token||token.length>JWT_MAX_BYTES)throw denied();
    const parts=token.split('.');
    if(parts.length!==3)throw denied();
    const header=objectPart(parts[0]),payload=objectPart(parts[1]);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256||header.crit!==undefined)throw denied();
    const key=await signingKey(config.teamDomain,header.kid);
    let valid;
    try {valid=await subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));}
    catch {throw denied();}
    if(!valid)throw denied();
    return validateClaims(payload,config,now());
  };
}

export const verifyGearOwnerAccess=createGearAccessVerifier();
