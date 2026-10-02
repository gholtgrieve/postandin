import {validateManagementEmail} from './gear-management-mail.mjs';

const ENDPOINT='https://api.resend.com/emails';
const FROM='Post & In Gear <gear@postandin.com>';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const EPISODE=/^[a-f0-9-]{36}$/;

export class GearMaintenanceAlertError extends Error{
  constructor(code){super('Gear maintenance alert unavailable.');this.code=code;}
}
const unavailable=code=>new GearMaintenanceAlertError(code);

export function validateMaintenanceAlertEnvironment(env){
  const key=env?.GEAR_RESEND_API_KEY,recipient=validateManagementEmail(env?.GEAR_ALERT_RECIPIENT);
  if(typeof key!=='string'||!key||key.length>512||/[\x00-\x20\x7f]/.test(key)||!recipient)throw unavailable('config');
  return {key,recipient};
}

export async function sendMaintenanceAlert(input,env,{fetcher=fetch,timeoutMs=10000}={}){
  const {key,recipient}=validateMaintenanceAlertEnvironment(env);
  if(!input||!['failure','recovery'].includes(input.kind)||!EPISODE.test(input.episode)
    ||!Number.isSafeInteger(input.at)||input.at<0||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable('input');
  const failure=input.kind==='failure';
  const subject=failure?'Gear maintenance needs attention':'Gear maintenance recovered';
  const text=failure
    ?`The scheduled Gear cleanup failed after its one-minute retry at ${new Date(input.at).toISOString()}. Check the Worker logs and bindings. No private record details are included in this alert.`
    :`The scheduled Gear cleanup recovered at ${new Date(input.at).toISOString()}. No private record details are included in this alert.`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response;
  try{
    response=await fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,headers:{
      Authorization:`Bearer ${key}`,'Content-Type':'application/json',
      'Idempotency-Key':`gear-maintenance-${input.kind}-${input.episode}`,
    },body:JSON.stringify({from:FROM,to:[recipient],subject,text})});
  }catch{throw unavailable('network');}
  finally{clearTimeout(timer);}
  if(!response.ok)throw unavailable(`status:${response.status}`);
  let data;try{data=await response.json();}catch{throw unavailable('response');}
  if(!data||typeof data.id!=='string'||!UUID.test(data.id))throw unavailable('response');
  return {id:data.id};
}
