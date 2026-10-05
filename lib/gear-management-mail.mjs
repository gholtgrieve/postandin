import {normalizeEmail} from './gear-validation.mjs';
import {gearPublicOrigin} from './gear-origins.mjs';
import {gearMailPolicyConfigured,gearMailRecipientAllowed} from './gear-mail-policy.mjs';

const ENDPOINT='https://api.resend.com/emails';
const FROM='Post & In Gear <gear@postandin.com>';
const SUBJECT='Your Post & In Gear Exchange management link';
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
  if(typeof key!=='string'||!key||key.length>512||/[\x00-\x20\x7f]/.test(key)||!origin||!gearMailPolicyConfigured(env))throw unavailable('config');
  if(!receipt||!validateManagementEmail(receipt.recipient)||!TOKEN.test(receipt.token)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable('input');
  if(!gearMailRecipientAllowed(receipt.recipient,env))throw unavailable('config');
  const link=`${origin}/gear/#management=${receipt.token}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,headers:{
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/json',
      'Idempotency-Key':`gear-management-${await hash(receipt.token)}`,
    },body:JSON.stringify({from:FROM,to:[receipt.recipient],subject:SUBJECT,text:receipt.durable
      ?`Your listing is live. Save this email so you can manage this listing later.\n\nUse this private link anytime to manage or recover this listing:\n\n${link}\n\nThe link is specific to this listing. Choose “Continue” on the page to start a 30-day management session for this listing only. Continuing replaces any current Gear management session in that browser and signs out any other device using this link. You can:\n\n- edit listing details\n- add, remove, or reorder photos\n- mark the gear pending or available\n- renew or relist when eligible\n- remove the listing and recover it for 30 days\n\nAnyone with this email can use the link, so do not forward it. The link stops working permanently after permanent deletion, a verified email change, or owner moderation; restoring a moderated listing does not reissue it. If you lose this email, choose “Manage my listings” at ${origin}/gear/ and request a temporary access link.`
      :`Use this private link within 30 minutes to access your Gear Exchange listings:\n\n${link}\n\nChoose “Continue” on the page to start a 30-day management session. Continuing replaces any current Gear management session in that browser and signs out other devices currently managing those listings. From My Listings, you can:\n\n- edit listing details\n- add, remove, or reorder photos\n- mark gear pending or available\n- renew or relist eligible listings\n- remove a listing and recover it for 30 days\n\nFor security, this link is one-use and expires after 30 minutes.`})});
  }catch{throw unavailable('network');}
  finally{clearTimeout(timer);}
  if(!response.ok)throw unavailable(`status:${response.status}`);
  let data;
  try{data=await response.json();}catch{throw unavailable('response');}
  if(!data||typeof data.id!=='string'||!UUID.test(data.id))throw unavailable('response');
  return {id:data.id};
}
