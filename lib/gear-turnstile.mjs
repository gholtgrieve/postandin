const SITEVERIFY_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESPONSE_MAX_BYTES=16*1024;
const TOKEN_MAX_BYTES=2048;
const SECRET_MAX_BYTES=512;
const EXPECTED_HOSTNAME='postandin.com';
const EXPECTED_ACTION='gear-report';
const VERIFY_TIMEOUT_MS=5000;
const PRINTABLE_ASCII=/^[\x21-\x7e]+$/;

export class GearTurnstileRejectedError extends Error {
  constructor({diagnostic=false}={}){super('Gear report verification rejected.');this.name='GearTurnstileRejectedError';this.diagnostic=diagnostic;}
}
export class GearTurnstileUnavailableError extends Error {
  constructor(message='Gear report verification is unavailable.',options){super(message,options);this.name='GearTurnstileUnavailableError';}
}

const rejected=(diagnostic=false)=>new GearTurnstileRejectedError({diagnostic});
const unavailable=(message,cause)=>new GearTurnstileUnavailableError(message,cause===undefined?undefined:{cause});

async function boundedJson(response){
  if(!response?.ok||!response.body)throw unavailable('Turnstile verification request failed.');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>RESPONSE_MAX_BYTES)throw unavailable('Turnstile response is too large.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let total=0,text='';
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>RESPONSE_MAX_BYTES){await reader.cancel();throw unavailable('Turnstile response is too large.');}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }catch(error){
    if(error instanceof GearTurnstileUnavailableError)throw error;
    throw unavailable('Unable to read Turnstile response.',error);
  }finally{reader.releaseLock();}
  try{return JSON.parse(text);}catch(error){throw unavailable('Invalid Turnstile response.',error);}
}

export function createTurnstileVerifier({fetchImpl=globalThis.fetch,timeoutMs=VERIFY_TIMEOUT_MS,expectedAction=EXPECTED_ACTION}={}){
  if(typeof fetchImpl!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<=0||typeof expectedAction!=='string'||!expectedAction)throw new TypeError('Invalid Turnstile verifier dependency.');
  return async function verifyGearReportTurnstile(token,env){
    const secret=typeof env?.GEAR_TURNSTILE_SECRET==='string'?env.GEAR_TURNSTILE_SECRET.trim():'';
    if(!secret||secret.length>SECRET_MAX_BYTES||!PRINTABLE_ASCII.test(secret))throw unavailable('Invalid Turnstile configuration.');
    if(typeof token!=='string'||!token||token.length>TOKEN_MAX_BYTES||!PRINTABLE_ASCII.test(token))throw rejected();
    let response;
    try{
      response=await fetchImpl(SITEVERIFY_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        redirect:'manual',
        signal:AbortSignal.timeout(timeoutMs),
        body:JSON.stringify({secret,response:token,idempotency_key:crypto.randomUUID()}),
      });
    }catch(error){throw unavailable('Unable to reach Turnstile verification.',error);}
    const result=await boundedJson(response);
    if(!result||typeof result!=='object'||Array.isArray(result))throw unavailable('Invalid Turnstile response.');
    if(result.success!==true){
      const codes=Array.isArray(result['error-codes'])?result['error-codes']:[];
      if(codes.some(code=>['internal-error','missing-input-secret','invalid-input-secret'].includes(code)))throw unavailable('Turnstile verification service failed.');
      throw rejected(codes.some(code=>['bad-request','missing-input-response'].includes(code)));
    }
    if(result.hostname!==EXPECTED_HOSTNAME||result.action!==expectedAction)throw rejected(true);
    return true;
  };
}

export const verifyGearReportTurnstile=createTurnstileVerifier();
export const verifyGearPostTurnstile=createTurnstileVerifier({expectedAction:'gear-post'});
