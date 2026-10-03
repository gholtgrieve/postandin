import {normalizeEmail} from './gear-validation.mjs';
import {GEAR_PRODUCTION_PUBLIC_ORIGIN,GEAR_STAGING_PUBLIC_ORIGIN,gearPublicOrigin} from './gear-origins.mjs';

const MAX_ALLOWLIST_BYTES=4096;

function stagingRecipients(env){
  const value=env?.GEAR_STAGING_MAIL_RECIPIENTS;
  if(typeof value!=='string'||!value||value.length>MAX_ALLOWLIST_BYTES||/[\x00-\x1f\x7f]/.test(value))return null;
  const recipients=[];
  for(const item of value.split(',')){
    let email;try{email=normalizeEmail(item.trim());}catch{return null;}
    if(!email||recipients.includes(email))return null;
    recipients.push(email);
  }
  return recipients.length?recipients:null;
}

export function gearMailPolicyConfigured(env){
  const origin=gearPublicOrigin(env);
  return origin===GEAR_PRODUCTION_PUBLIC_ORIGIN||(origin===GEAR_STAGING_PUBLIC_ORIGIN&&Boolean(stagingRecipients(env)));
}

export function gearMailRecipientAllowed(recipient,env){
  const origin=gearPublicOrigin(env);
  if(origin===GEAR_PRODUCTION_PUBLIC_ORIGIN)return true;
  if(origin!==GEAR_STAGING_PUBLIC_ORIGIN)return false;
  let email;try{email=normalizeEmail(recipient);}catch{return false;}
  const recipients=stagingRecipients(env);
  return recipient===email&&Boolean(recipients?.includes(email));
}
