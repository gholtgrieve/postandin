import {gearPublicOrigin} from './gear-origins.mjs';

export const MANAGEMENT_BODY_MAX_BYTES=1024;
export const MANAGEMENT_HEADERS={
  'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
export const managementJson=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{...MANAGEMENT_HEADERS,...extra}});

export function managementRequestError(request,env){
  let url;
  try{url=new URL(request.url);}catch{return managementJson(403,{error:'Request not allowed.'});}
  const origin=gearPublicOrigin(env);
  if(!origin||url.origin!==origin||request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return managementJson(403,{error:'Request not allowed.'});
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return managementJson(415,{error:'Use JSON.'});
  return null;
}

export function managementSession(request){
  const name='__Host-gear_session';
  const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>{
    const separator=value.indexOf('=');return separator>0&&value.slice(0,separator)===name;
  });
  return values.length===1?values[0].slice(name.length+1):'';
}

export function managementCookie(value,maxAge){
  return `__Host-gear_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function managementRequestJson(request,maxBytes=MANAGEMENT_BODY_MAX_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)throw new TypeError('Invalid management body limit.');
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)return {tooLarge:true};
  if(!request.body)return {invalid:true};
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let total=0,text='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){try{await reader.cancel();}catch{}return {tooLarge:true};}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }catch{return {invalid:true};}
  finally{reader.releaseLock();}
  try{return {value:JSON.parse(text)};}catch{return {invalid:true};}
}
