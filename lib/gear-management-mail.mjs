import {normalizeEmail} from './gear-validation.mjs';
import {gearPublicOrigin} from './gear-origins.mjs';

const ENDPOINT='https://api.resend.com/emails';
const FROM='Post & In Gear <gear@postandin.com>';
const SUBJECT='Your Post & In Gear management link';
const TOKEN=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class GearManagementMailUnavailableError extends Error{
  constructor(code){super('Gear management mail unavailable.');this.code=code;}
}
const unavailable=code=>new GearManagementMailUnavailableError(code);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));

export function validateManagementEmail(value){
  try{return normalizeEmail(value);}catch{return null;}
}

export async function sendManagementLink(receipt,env,{fetcher=fetch,timeoutMs=10000}={}){
  const key=env?.GEAR_RESEND_API_KEY,origin=gearPublicOrigin(env);
  if(typeof key!=='string'||!key||key.length>512||/[\x00-\x20\x7f]/.test(key)||!origin)throw unavailable('config');
  if(!receipt||!validateManagementEmail(receipt.recipient)||!TOKEN.test(receipt.token)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable('input');
  const link=`${origin}/gear/#management=${receipt.token}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,headers:{
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/json',
      'Idempotency-Key':`gear-management-${await hash(receipt.token)}`,
    },body:JSON.stringify({from:FROM,to:[receipt.recipient],subject:SUBJECT,text:`Use this link to return to your Gear Exchange listings:\n\n${link}\n\nThe link expires in 30 minutes. Opening it does not make changes; confirm access on the Post & In page.`})});
  }catch{throw unavailable('network');}
  finally{clearTimeout(timer);}
  if(!response.ok)throw unavailable(`status:${response.status}`);
  let data;
  try{data=await response.json();}catch{throw unavailable('response');}
  if(!data||typeof data.id!=='string'||!UUID.test(data.id))throw unavailable('response');
  return {id:data.id};
}
