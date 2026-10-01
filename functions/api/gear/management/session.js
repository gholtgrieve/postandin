import {recoverManagementSession} from '../../../../lib/gear-management.mjs';
import {managementJson,managementRequestError,managementRequestJson,managementSession} from '../../../../lib/gear-management-http.mjs';

export function createManagementSessionHandler({recover=recoverManagementSession,now=Date.now}={}){
  return async function managementSessionRecovery(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const session=managementSession(context.request);
    if(!session)return managementJson(401,{error:'Access unavailable.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return managementJson(413,{error:'Request too large.'});
    if(body.invalid)return managementJson(400,{error:'Invalid request.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear management database is not configured.');return managementJson(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const access=await recover(db,session,now());
      return access?managementJson(200,access):managementJson(401,{error:'Access unavailable.'});
    }catch(error){
      console.error('Gear management session recovery failed:',error);
      return managementJson(500,{error:'Unable to recover listing access right now.'});
    }
  };
}

export const onRequestPost=createManagementSessionHandler();
