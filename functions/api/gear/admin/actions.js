import {GearAccessDeniedError,GearAccessUnavailableError,verifyGearOwnerAccess} from '../../../../lib/gear-access.mjs';
import {moderateListing,validateModerationAction} from '../../../../lib/gear-moderation-actions.mjs';
import {gearAdminOrigin} from '../../../../lib/gear-origins.mjs';

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

export function createOwnerActionHandler({verify=verifyGearOwnerAccess,moderate=moderateListing,now=Date.now}={}){
  return async function ownerAction(context){
    let url;
    try{url=new URL(context.request.url);}catch{return json(403,{error:'Request not allowed.'});}
    const origin=gearAdminOrigin(context.env);
    if(!origin||url.origin!==origin||context.request.headers.get('origin')!==origin||context.request.headers.get('sec-fetch-site')==='cross-site')return json(403,{error:'Request not allowed.'});
    if(context.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json(415,{error:'Use JSON.'});
    let identity;
    try{identity=await verify(context.request,context.env);}
    catch(error){
      if(error instanceof GearAccessUnavailableError){console.error('Gear owner access verification is unavailable:',error);return json(503,{error:'Owner access is temporarily unavailable.'});}
      if(!(error instanceof GearAccessDeniedError))console.error('Gear owner access verification failed:',error);
      return json(403,{error:'Access denied.'});
    }
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    const input=validateModerationAction(body.value);
    if(!input)return json(400,{error:'Choose an action and provide a valid reason.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear moderation database is not configured.');return json(503,{error:'Gear moderation is temporarily unavailable.'});}
    try{
      const accepted=await moderate(db,{...input,actor:identity?.email},now());
      if(!accepted)return json(409,{error:'The listing or report changed, or restoration is not eligible. Refresh and review it.'});
      return json(200,{ok:true});
    }catch(error){
      console.error('Gear moderation action failed:',error);
      return json(500,{error:'Unable to process the moderation action right now.'});
    }
  };
}

export const onRequestPost=createOwnerActionHandler();
