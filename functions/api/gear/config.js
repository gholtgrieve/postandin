const ORIGIN='https://postandin.com';
const SITE_KEY=/^[\x21-\x7e]{1,128}$/;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});

export function createGearConfigHandler(){
  return async function gearConfig(context){
    const request=context.request,url=new URL(request.url);
    if(url.origin!==ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')return json(403,{error:'Request unavailable.'});
    const key=typeof context.env?.GEAR_TURNSTILE_SITE_KEY==='string'?context.env.GEAR_TURNSTILE_SITE_KEY.trim():'';
    if(!SITE_KEY.test(key)||/\s/.test(key))return json(503,{error:'Gear posting is temporarily unavailable.'});
    return json(200,{turnstileSiteKey:key});
  };
}

export const onRequestGet=createGearConfigHandler();
