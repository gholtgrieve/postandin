import {createPrivateGearPhotoUpload,GearImageUploadError,sanitizeQuarantinedHostedImage} from '../../lib/gear-image-upload.mjs';
import {isGearImageProviderId} from '../../lib/gear-image-provider-id.mjs';

const MAX_BODY_BYTES=512;
const GEAR_IMAGE_SERVICE_DELETE_TIMEOUT_MS=4000;
const HEADERS={'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

async function body(request){
  if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return {error:415};
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)return {error:413};
  if(!request.body)return {error:400};
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES){try{await reader.cancel();}catch{}return {error:413};}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
  }catch{return {error:400};}finally{reader.releaseLock();}
  try{return {value:JSON.parse(text)}}catch{return {error:400};}
}

function configured(images){
  return images?.hosted?.createDirectUpload&&images?.hosted?.image&&images?.hosted?.upload&&images?.info&&images?.input;
}

async function boundedDelete(images,providerId,timeoutMs){
  let timer;
  try{return await Promise.race([images.hosted.image(providerId).delete(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

export function createGearImagesWorker({create=createPrivateGearPhotoUpload,sanitize=sanitizeQuarantinedHostedImage,deleteTimeoutMs=GEAR_IMAGE_SERVICE_DELETE_TIMEOUT_MS}={}){
  if(!Number.isSafeInteger(deleteTimeoutMs)||deleteTimeoutMs<1||deleteTimeoutMs>30000)throw new TypeError('Invalid Gear Images delete timeout.');
  return {async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
    if(!configured(env?.IMAGES)){console.error('Gear Images binding is not configured.');return json(503,{error:'Photo service unavailable.'});}
    const parsed=await body(request);
    if(parsed.error)return json(parsed.error,{error:parsed.error===413?'Request too large.':parsed.error===415?'Use JSON.':'Invalid request.'});
    try{
      if(url.pathname==='/internal/gear/photos/upload'){
        if(!parsed.value||typeof parsed.value!=='object'||Array.isArray(parsed.value)||Object.keys(parsed.value).length)return json(400,{error:'Invalid request.'});
        return json(201,await create(env.IMAGES));
      }
      if(url.pathname==='/internal/gear/photos/sanitize'){
        const id=parsed.value?.quarantineProviderId;
        if(!isGearImageProviderId(id)||Object.keys(parsed.value).length!==1)return json(400,{error:'Invalid request.'});
        return json(200,await sanitize(env.IMAGES,id));
      }
      if(url.pathname==='/internal/gear/photos/delete'){
        const id=parsed.value?.providerId;
        if(!isGearImageProviderId(id)||Object.keys(parsed.value).length!==1)return json(400,{error:'Invalid request.'});
        await boundedDelete(env.IMAGES,id,deleteTimeoutMs);return json(200,{ok:true});
      }
      return json(404,{error:'Not found.'});
    }catch(error){
      if(error instanceof GearImageUploadError){
        if(error.code==='pending')return json(409,{error:'pending'});
        if(error.code==='unavailable')return json(503,{error:'unavailable'});
        if(error.code==='config'||url.pathname==='/internal/gear/photos/upload')return json(503,{error:'unavailable',...(error.cleanupProviderIds.length?{cleanupProviderIds:error.cleanupProviderIds}:{})});
        return json(422,{error:'rejected',cleanupProviderIds:error.cleanupProviderIds});
      }
      console.error('Gear Images operation failed. unexpected');return json(503,{error:'Photo service unavailable.'});
    }
  }};
}

export default createGearImagesWorker();
