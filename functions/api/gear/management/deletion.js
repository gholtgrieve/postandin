import {changeSellerDeletion,validateSellerDeletionAction} from '../../../../lib/gear-seller-deletion.mjs';

const PUBLIC_ORIGIN='https://postandin.com';
const BODY_MAX_BYTES=1024;
const HEADERS={
  'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

function sessionCookie(request){
  const name='__Host-gear_session';
  const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.slice(0,value.indexOf('='))===name);
  return values.length===1?values[0].slice(name.length+1):'';
}

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

export function createSellerDeletionHandler({change=changeSellerDeletion,now=Date.now}={}){
  return async function sellerDeletion(context){
    let url;
    try{url=new URL(context.request.url);}catch{return json(403,{error:'Request not allowed.'});}
    if(url.origin!==PUBLIC_ORIGIN||context.request.headers.get('origin')!==PUBLIC_ORIGIN||context.request.headers.get('sec-fetch-site')==='cross-site')return json(403,{error:'Request not allowed.'});
    if(context.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json(415,{error:'Use JSON.'});
    const session=sessionCookie(context.request);
    if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';
    if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    const input=validateSellerDeletionAction(body.value);
    if(!input)return json(400,{error:'Choose a listing and action.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear seller deletion database is not configured.');return json(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const result=await change(db,session,csrf,input,now());
      if(!result.ok)return result.reason==='access'?json(401,{error:'Access unavailable.'}):json(409,{error:'This listing cannot be recovered or changed. Refresh and check its recovery deadline.'});
      return json(200,{ok:true});
    }catch(error){
      console.error('Gear seller deletion action failed:',error);
      return json(500,{error:'Unable to change this listing right now.'});
    }
  };
}

export const onRequestPost=createSellerDeletionHandler();
