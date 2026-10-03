import { GearAccessDeniedError, GearAccessUnavailableError, verifyGearOwnerAccess } from '../../../../lib/gear-access.mjs';

const HEADERS={
  'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

export function createOwnerSessionHandler(verify=verifyGearOwnerAccess) {
  return async function ownerSession(context) {
    try {
      await verify(context.request,context.env);
      return json(200,{authenticated:true});
    } catch(error) {
      if(error instanceof GearAccessUnavailableError){
        console.error('Gear owner access verification is unavailable:',error);
        return json(503,{error:'Owner access is temporarily unavailable.'});
      }
      if(!(error instanceof GearAccessDeniedError))console.error('Gear owner access verification failed:',error);
      return json(403,{error:'Access denied.'});
    }
  };
}

// Authentication probe only. It exposes no moderation data and performs no writes.
export const onRequestGet=createOwnerSessionHandler();
