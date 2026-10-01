import {validateContactSubmission,reserveContact,claimContactDelivery,releaseContactDelivery,markContactSent} from '../../../lib/gear-contact-storage.mjs';
import {contactDeliveryConfigured,GearContactMailUnavailableError,sendContactMessage} from '../../../lib/gear-contact-mail.mjs';
import {GearTurnstileRejectedError,GearTurnstileUnavailableError,verifyGearContactTurnstile} from '../../../lib/gear-turnstile.mjs';
import {gearPublicOrigin} from '../../../lib/gear-origins.mjs';

const BODY_MAX_BYTES=8192;
const HEADERS={'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
async function requestJson(request){
  const declared=Number(request.headers.get('content-length'));if(Number.isFinite(declared)&&declared>BODY_MAX_BYTES)return {tooLarge:true};if(!request.body)return {invalid:true};
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>BODY_MAX_BYTES){try{await reader.cancel();}catch{}return {tooLarge:true};}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  catch{return {invalid:true};}finally{reader.releaseLock();}
  try{return {value:JSON.parse(text)};}catch{return {invalid:true};}
}

export function createContactHandler({verify=verifyGearContactTurnstile,reserve=reserveContact,claim=claimContactDelivery,release=releaseContactDelivery,deliver=sendContactMessage,mark=markContactSent,now=Date.now}={}){
  return async function contact(context){
    let url;try{url=new URL(context.request.url);}catch{return json(403,{error:'Request not allowed.'});}
    const origin=gearPublicOrigin(context.env);
    if(!origin||url.origin!==origin||context.request.headers.get('origin')!==origin||context.request.headers.get('sec-fetch-site')==='cross-site')return json(403,{error:'Request not allowed.'});
    if(context.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json(415,{error:'Use JSON.'});
    const body=await requestJson(context.request);if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const input=validateContactSubmission(body.value);if(!input)return json(400,{error:'Confirm you are 18 or older and check your contact details and sharing acknowledgement.'});
    const db=context.env?.GEAR_DB;if(!db||!contactDeliveryConfigured(context.env)){console.error('Gear contact delivery is not configured.');return json(503,{error:'Buyer contact is temporarily unavailable.'});}
    try{await verify(input.turnstileToken,context.env);}catch(error){if(error instanceof GearTurnstileRejectedError)return json(400,{error:'Complete the verification and try again.'});if(error instanceof GearTurnstileUnavailableError)console.error('Gear contact verification is unavailable.');else console.error('Gear contact verification failed.');return json(503,{error:'Buyer contact is temporarily unavailable.'});}
    let reservation;try{reservation=await reserve(db,input,now());}catch(error){console.error('Gear contact reservation failed.');return json(500,{error:'Unable to contact this seller right now.'});}
    if(reservation.limited){const response=json(429,{error:'Too many contact attempts. Please try again later.'});response.headers.set('Retry-After','600');return response;}
    if(reservation.conflict)return json(409,{error:'Start a new contact request and try again.'});
    if(reservation.expired||reservation.stale)return json(409,{error:'Start a new contact request and try again.'});
    if(reservation.unavailable)return json(404,{error:'This listing is no longer available for contact.'});
    if(reservation.contact.status==='sent')return json(202,{ok:true,message:'Message accepted for delivery.'});
    let deliveryClaim;try{deliveryClaim=await claim(db,reservation.contact.id,now());}catch{console.error('Gear contact delivery claim failed.');return json(503,{error:'Unable to send this message right now. Please try again.'});}
    if(deliveryClaim.sent)return json(202,{ok:true,message:'Message accepted for delivery.'});
    if(deliveryClaim.busy){const response=json(503,{error:'This contact request is already being processed. Wait and try again.'});response.headers.set('Retry-After','60');return response;}
    if(deliveryClaim.expired||deliveryClaim.stale)return json(409,{error:'Start a new contact request and try again.'});
    if(deliveryClaim.unavailable)return json(404,{error:'This listing is no longer available for contact.'});
    if(!deliveryClaim.claimed)return json(409,{error:'Start a new contact request and try again.'});
    let receipt;try{receipt=await deliver(reservation.contact,context.env);}catch(error){try{await release(db,reservation.contact.id,deliveryClaim.token);}catch{}console.error('Gear contact email delivery failed.',error instanceof GearContactMailUnavailableError?'provider':'unexpected');return json(503,{error:'Unable to send this message right now. Please try again.'});}
    try{if(!await mark(db,reservation.contact.id,receipt.id,now(),deliveryClaim.token))throw new Error();}catch{console.error('Gear contact delivery receipt could not be recorded.');return json(503,{error:'Unable to confirm this message right now. Please try again.'});}
    return json(202,{ok:true,message:'Message accepted for delivery.'});
  };
}
export const onRequestPost=createContactHandler();
