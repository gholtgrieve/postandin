import {normalizeEmail} from './gear-validation.mjs';

const ENDPOINT='https://api.resend.com/emails',FROM='Post & In Gear <gear@postandin.com>',SUBJECT='Question about your Post & In Gear listing';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_RESPONSE_BYTES=4096;

export class GearContactMailUnavailableError extends Error{constructor(code){super('Gear contact mail unavailable.');this.code=code;}}
const unavailable=code=>new GearContactMailUnavailableError(code);
const validKey=key=>typeof key==='string'&&key.length>0&&key.length<=512&&/^[\x21-\x7e]+$/.test(key);
export const contactMailConfigured=env=>validKey(env?.GEAR_RESEND_API_KEY);
export const contactDeliveryConfigured=env=>env?.GEAR_CONTACT_ENABLED==='true'&&contactMailConfigured(env);

async function waitWithAbort(operation,signal){
  if(signal.aborted)throw unavailable('network');let onAbort;
  const aborted=new Promise((_resolve,reject)=>{onAbort=()=>reject(unavailable('network'));signal.addEventListener('abort',onAbort,{once:true});});
  try{return await Promise.race([operation,aborted]);}finally{signal.removeEventListener('abort',onAbort);}
}

async function boundedJson(response,signal){
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>MAX_RESPONSE_BYTES)throw unavailable('response');if(!response.body)throw unavailable('response');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{while(true){const {done,value}=await waitWithAbort(reader.read(),signal);if(done)break;total+=value.byteLength;if(total>MAX_RESPONSE_BYTES){await reader.cancel();throw unavailable('response');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  catch(error){if(error instanceof GearContactMailUnavailableError)throw error;throw unavailable('network');}finally{if(signal.aborted){try{await reader.cancel();}catch{}}reader.releaseLock();}
  try{return JSON.parse(text);}catch{throw unavailable('response');}
}

export async function sendContactMessage(contact,env,{fetcher=fetch,timeoutMs=10000}={}){
  if(!validKey(env?.GEAR_RESEND_API_KEY))throw unavailable('config');
  if(!contact||!UUID.test(contact.id??'')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw unavailable('input');
  let recipient,buyerEmail;try{recipient=normalizeEmail(contact.recipient);buyerEmail=normalizeEmail(contact.buyerEmail);}catch{throw unavailable('input');}
  if(recipient!==contact.recipient||buyerEmail!==contact.buyerEmail||typeof contact.buyerName!=='string'||!contact.buyerName||contact.buyerName.length>60||/[\x00-\x1f\x7f]/.test(contact.buyerName)||typeof contact.listingTitle!=='string'||!contact.listingTitle||contact.listingTitle.length>100||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(contact.listingTitle)||typeof contact.message!=='string'||!contact.message||contact.message.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(contact.message))throw unavailable('input');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let response,data;
  try{
    response=await waitWithAbort(fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:controller.signal,headers:{Authorization:`Bearer ${env.GEAR_RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`gear-contact-${contact.id}`},body:JSON.stringify({from:FROM,to:[recipient],reply_to:buyerEmail,subject:SUBJECT,text:`${contact.buyerName} sent a message about “${contact.listingTitle}”.\n\n${contact.message}\n\nBuyer email: ${buyerEmail}\nReplying to this email will reply to the buyer.`})}),controller.signal);
    if(!response.ok)throw unavailable(`status:${response.status}`);data=await boundedJson(response,controller.signal);
  }catch(error){if(error instanceof GearContactMailUnavailableError)throw error;throw unavailable('network');}
  finally{clearTimeout(timer);}
  if(!data||!UUID.test(data.id??''))throw unavailable('response');return {id:data.id};
}
