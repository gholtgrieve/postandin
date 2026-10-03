import { GearAccessDeniedError, GearAccessUnavailableError, verifyGearOwnerAccess } from '../../../../lib/gear-access.mjs';
import {readActiveModerationRemovals,readOpenModerationReports} from '../../../../lib/gear-moderation-storage.mjs';

const HEADERS={
  'Content-Type':'application/json; charset=UTF-8',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});

export function createOwnerReportsHandler({verify=verifyGearOwnerAccess,readReports=readOpenModerationReports,readRemovals=readActiveModerationRemovals}={}) {
  return async function ownerReports(context) {
    try {
      await verify(context.request,context.env);
    } catch(error) {
      if(error instanceof GearAccessUnavailableError){
        console.error('Gear owner access verification is unavailable:',error);
        return json(503,{error:'Owner access is temporarily unavailable.'});
      }
      if(!(error instanceof GearAccessDeniedError))console.error('Gear owner access verification failed:',error);
      return json(403,{error:'Access denied.'});
    }

    const db=context.env?.GEAR_DB;
    if(!db){
      console.error('Gear moderation database is not configured.');
      return json(503,{error:'Gear moderation is temporarily unavailable.'});
    }
    try {
      return json(200,{...await readReports(db),...await readRemovals(db)});
    } catch(error) {
      console.error('Gear moderation reports request failed:',error);
      return json(500,{error:'Unable to load moderation reports right now.'});
    }
  };
}

// Read-only owner route. Report submission and moderation actions are separate.
export const onRequestGet=createOwnerReportsHandler();
