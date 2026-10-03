import {revokeManagement} from '../../../../lib/gear-management.mjs';
import {managementCookie,managementJson,managementRequestError,managementRequestJson,managementSession} from '../../../../lib/gear-management-http.mjs';

export function createManagementLogoutHandler({revoke=revokeManagement,now=Date.now}={}){
  return async function managementLogout(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const session=managementSession(context.request);
    if(!session)return managementJson(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';
    if(!csrf)return managementJson(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return managementJson(413,{error:'Request too large.'});
    if(body.invalid)return managementJson(400,{error:'Invalid request.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear management database is not configured.');return managementJson(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const revoked=await revoke(db,session,csrf,now());
      if(!revoked)return managementJson(401,{error:'Access unavailable.'},{'Set-Cookie':managementCookie('',0)});
      return managementJson(200,{ok:true},{'Set-Cookie':managementCookie('',0)});
    }catch(error){
      console.error('Gear management logout failed:',error);
      return managementJson(500,{error:'Unable to end listing access right now.'});
    }
  };
}

export const onRequestPost=createManagementLogoutHandler();
