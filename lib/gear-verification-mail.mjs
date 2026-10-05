import {normalizeEmail} from './gear-validation.mjs';
import {gearPublicOrigin} from './gear-origins.mjs';
import {gearMailPolicyConfigured,gearMailRecipientAllowed} from './gear-mail-policy.mjs';

const ENDPOINT='https://api.resend.com/emails';
const FROM='Post & In Gear <gear@postandin.com>';
const SUBJECT='Verify your Post & In Gear listing';
const TOKEN=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RESPONSE_MAX_BYTES=4096;

export class GearVerificationMailUnavailableError extends Error{
  constructor(code,{releasable=false}={}){super('Gear verification mail unavailable.');this.code=code;this.releasable=releasable;}
}
const unavailable=(code,releasable=false)=>new GearVerificationMailUnavailableError(code,{releasable});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const validKey=key=>typeof key==='string'&&key.length>0&&key.length<=512&&/^[\x21-\x7e]+$/.test(key);

export const verificationMailConfigured=env=>validKey(env?.GEAR_RESEND_API_KEY)&&gearMailPolicyConfigured(env);

async function waitWithAbort(operation,signal){
  if(signal.aborted)throw unavailable('network');
  let onAbort;
  const aborted=new Promise((_resolve,reject)=>{onAbort=()=>reject(unavailable('network'));signal.addEventListener('abort',onAbort,{once:true});});
  try{return await Promise.race([operation,aborted]);}
  finally{signal.removeEventListener('abort',onAbort);}
}

async function boundedJson(response,signal){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>RESPONSE_MAX_BYTES)throw unavailable('response');
  if(!response.body)throw unavailable('response');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{
    while(true){const {done,value}=await waitWithAbort(reader.read(),signal);if(done)break;total+=value.byteLength;if(total>RESPONSE_MAX_BYTES){await reader.cancel();throw unavailable('response');}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
  }catch(error){if(error instanceof GearVerificationMailUnavailableError)throw error;throw unavailable('network');}
  finally{if(signal.aborted){try{await reader.cancel();}catch{}}reader.releaseLock();}
  try{return JSON.parse(text);}catch{throw unavailable('response');}
}

export async function sendVerificationLink(receipt,env,{fetcher=fetch,timeoutMs=10000}={}){
  const key=env?.GEAR_RESEND_API_KEY,origin=gearPublicOrigin(env);
  if(!verificationMailConfigured(env)||!origin)throw unavailable('config',true);
  let recipient;try{recipient=normalizeEmail(receipt?.recipient);}catch{throw unavailable('input',true);}
  if(recipient!==receipt.recipient||!TOKEN.test(receipt?.token)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable('input',true);
  if(!gearMailRecipientAllowed(recipient,env))throw unavailable('config',true);
  const link=`${origin}/gear/#verification=${receipt.token}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response,data;
  try{
    response=await waitWithAbort(fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,headers:{
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/json',
      'Idempotency-Key':`gear-verification-${await hash(receipt.token)}`,
    },body:JSON.stringify({from:FROM,to:[recipient],subject:SUBJECT,text:`Open this link to verify your email for one Gear Exchange listing:\n\n${link}\n\nThe link expires in 30 minutes. Opening it does not publish anything; confirm publication on the Post & In page.`})}),controller.signal);
    if(!response.ok)throw unavailable(`status:${response.status}`,response.status<500);
    data=await boundedJson(response,controller.signal);
  }catch(error){if(error instanceof GearVerificationMailUnavailableError)throw error;throw unavailable('network');}
  finally{clearTimeout(timer);}
  if(!data||typeof data.id!=='string'||!UUID.test(data.id))throw unavailable('response');
  return {id:data.id};
}
