import {validateReportSubmission,submitReport} from '../../../lib/gear-report-storage.mjs';
import {GearTurnstileRejectedError,GearTurnstileUnavailableError,verifyGearReportTurnstile} from '../../../lib/gear-turnstile.mjs';

const PUBLIC_ORIGIN='https://postandin.com';
const BODY_MAX_BYTES=4096;
const HEADERS={
  'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

async function requestJson(request){
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>BODY_MAX_BYTES)return {tooLarge:true};
  if(!request.body)return {invalid:true};
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let total=0,text='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>BODY_MAX_BYTES){try{await reader.cancel();}catch{}return {tooLarge:true};}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }catch{return {invalid:true};}
  finally{reader.releaseLock();}
  try{return {value:JSON.parse(text)};}catch{return {invalid:true};}
}

export function createReportSubmissionHandler({verify=verifyGearReportTurnstile,submit=submitReport,now=Date.now,randomUUID=()=>crypto.randomUUID()}={}){
  return async function reportSubmission(context){
    let url;
    try{url=new URL(context.request.url);}catch{return json(403,{error:'Request not allowed.'});}
    if(url.origin!==PUBLIC_ORIGIN||context.request.headers.get('origin')!==PUBLIC_ORIGIN||context.request.headers.get('sec-fetch-site')==='cross-site')return json(403,{error:'Request not allowed.'});
    if(context.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json(415,{error:'Use JSON.'});
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    const input=validateReportSubmission(body.value);
    if(!input)return json(400,{error:'Choose a supported report reason and listing.'});
    const db=context.env?.GEAR_DB;
    if(!db||context.env?.GEAR_REPORTS_ENABLED!=='true'){console.error('Gear reports are not configured.');return json(503,{error:'Reports are temporarily unavailable.'});}
    try{
      await verify(input.turnstileToken,context.env);
    }catch(error){
      if(error instanceof GearTurnstileRejectedError){
        if(error.diagnostic)console.warn('Gear report verification rejected due to a configuration or request mismatch.');
        return json(400,{error:'Complete the verification and try again.'});
      }
      if(error instanceof GearTurnstileUnavailableError){console.error('Gear report verification is unavailable:',error);return json(503,{error:'Reports are temporarily unavailable.'});}
      console.error('Gear report verification failed:',error);return json(503,{error:'Reports are temporarily unavailable.'});
    }
    try{
      const accepted=await submit(db,{listingId:input.listingId,reason:input.reason},now(),randomUUID());
      if(!accepted)return json(404,{error:'This listing is no longer available to report.'});
      return json(201,{ok:true,message:'Report received for owner review. No automatic action was taken.'});
    }catch(error){
      console.error('Gear report submission failed:',error);
      return json(500,{error:'Unable to submit this report right now.'});
    }
  };
}

export const onRequestPost=createReportSubmissionHandler();
