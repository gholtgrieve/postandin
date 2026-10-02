const SCRIPT_URL='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SITE_KEY=/^[\x21-\x7e]{1,128}$/;

export function validTurnstileSiteKey(value){return typeof value==='string'&&SITE_KEY.test(value)&&! /\s/.test(value);}

function usable(value){return value&&typeof value.render==='function'&&typeof value.reset==='function';}

export async function loadProductionTurnstile({siteKey,documentValue=document,windowValue=window,timeoutMs=10000}={}){
  if(!validTurnstileSiteKey(siteKey)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Gear posting verification is unavailable.');
  if(usable(windowValue.turnstile))return windowValue.turnstile;
  let script=documentValue.querySelector('script[data-gear-turnstile]');
  if(!script){script=documentValue.createElement('script');script.dataset.gearTurnstile='true';script.src=SCRIPT_URL;script.async=true;script.defer=true;script.referrerPolicy='no-referrer';documentValue.head.append(script);}
  await new Promise((resolve,reject)=>{
    const fail=()=>reject(new Error('Gear posting verification is unavailable.'));
    const timer=setTimeout(()=>finish(fail),timeoutMs);
    const loaded=()=>usable(windowValue.turnstile)?finish(resolve):finish(fail);
    const failed=()=>finish(fail);
    function finish(done){clearTimeout(timer);script.removeEventListener('load',loaded);script.removeEventListener('error',failed);done();}
    script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});
  });
  if(!usable(windowValue.turnstile))throw new Error('Gear posting verification is unavailable.');
  return windowValue.turnstile;
}

export const TURNSTILE_SCRIPT_URL=SCRIPT_URL;
