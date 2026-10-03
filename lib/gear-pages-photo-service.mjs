import {isGearImageProviderId} from './gear-image-provider-id.mjs';

const SERVICE_ORIGIN='https://gear-images.internal';
const RESPONSE_MAX_BYTES=2048;
const CLEANUP_ID=/^[A-Za-z0-9_-]{1,128}$/;

function exact(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}

function cleanup(value){
  return Array.isArray(value)&&value.length<=8&&value.every(id=>typeof id==='string'&&CLEANUP_ID.test(id))
    ?[...new Set(value)]:null;
}

async function boundedJson(response){
  if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')return null;
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>RESPONSE_MAX_BYTES)return null;
  if(!response.body)return null;
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let total=0,text='';
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>RESPONSE_MAX_BYTES){try{await reader.cancel();}catch{}return null;}text+=decoder.decode(value,{stream:true});}
    text+=decoder.decode();
  }catch{return null;}finally{reader.releaseLock();}
  try{return JSON.parse(text);}catch{return null;}
}

async function call(service,path,input){
  if(!service?.fetch)return {kind:'unavailable',cleanupProviderIds:[]};
  let response;
  try{response=await service.fetch(new Request(SERVICE_ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));}
  catch{return {kind:'unavailable',cleanupProviderIds:[]};}
  const value=await boundedJson(response);
  if(!value)return {kind:'unavailable',cleanupProviderIds:[]};
  const parsedCleanup=Object.hasOwn(value,'cleanupProviderIds')?cleanup(value.cleanupProviderIds):[];
  return {response,value,cleanupProviderIds:parsedCleanup??[],cleanupValid:parsedCleanup!==null};
}

export async function createGearPhotoUpload(service){
  const result=await call(service,'/internal/gear/photos/upload',{});
  if(result.kind)return result;
  const {response,value,cleanupProviderIds,cleanupValid}=result;
  if(response.status===201&&cleanupValid&&exact(value,['quarantineProviderId','uploadURL'])&&isGearImageProviderId(value.quarantineProviderId)){
    try{
      const url=new URL(value.uploadURL);
      if(url.protocol==='https:'&&url.hostname==='upload.imagedelivery.net')return {kind:'created',quarantineProviderId:value.quarantineProviderId,uploadURL:url.href,cleanupProviderIds:[]};
    }catch{}
  }
  if(response.status===201&&typeof value?.quarantineProviderId==='string'&&CLEANUP_ID.test(value.quarantineProviderId)){
    return {kind:'unavailable',cleanupProviderIds:[...new Set([value.quarantineProviderId,...cleanupProviderIds])]};
  }
  if(response.status===503&&cleanupValid&&exact(value,cleanupProviderIds.length?['error','cleanupProviderIds']:['error'])
    &&(value.error==='unavailable'||value.error==='Photo service unavailable.'))return {kind:'unavailable',cleanupProviderIds};
  return {kind:'unavailable',cleanupProviderIds};
}

export async function sanitizeGearPhoto(service,quarantineProviderId){
  const result=await call(service,'/internal/gear/photos/sanitize',{quarantineProviderId});
  if(result.kind)return result;
  const {response,value,cleanupProviderIds,cleanupValid}=result;
  if(response.status===200&&cleanupValid&&exact(value,['providerId','cleanupProviderIds'])&&isGearImageProviderId(value.providerId)
    &&value.providerId!==quarantineProviderId
    &&!cleanupProviderIds.includes(value.providerId))return {kind:'ready',providerId:value.providerId,cleanupProviderIds};
  if(response.status===200&&typeof value?.providerId==='string'&&CLEANUP_ID.test(value.providerId)){
    return {kind:'rejected',cleanupProviderIds:[...new Set([value.providerId,...cleanupProviderIds])]};
  }
  if(response.status===409&&exact(value,['error'])&&value.error==='pending')return {kind:'pending',cleanupProviderIds:[]};
  if(response.status===503&&cleanupValid&&exact(value,cleanupProviderIds.length?['error','cleanupProviderIds']:['error'])
    &&(value.error==='unavailable'||value.error==='Photo service unavailable.'))return {kind:'unavailable',cleanupProviderIds};
  if(response.status===422&&cleanupValid&&exact(value,['error','cleanupProviderIds'])&&value.error==='rejected')return {kind:'rejected',cleanupProviderIds};
  return {kind:'unavailable',cleanupProviderIds:[]};
}

export async function deleteGearPhotoImmediately(service,providerId){
  const result=await call(service,'/internal/gear/photos/delete',{providerId});
  return !result.kind&&result.response.status===200&&exact(result.value,['ok'])&&result.value.ok===true;
}
