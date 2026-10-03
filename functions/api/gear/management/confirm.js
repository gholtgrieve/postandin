import {MANAGEMENT_TTL_MS,redeemManagementLink} from '../../../../lib/gear-management.mjs';
import {managementCookie,managementJson,managementRequestError,managementRequestJson} from '../../../../lib/gear-management-http.mjs';

export function createManagementConfirmHandler({redeem=redeemManagementLink,now=Date.now}={}){
  return async function managementConfirm(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return managementJson(413,{error:'Request too large.'});
    if(body.invalid)return managementJson(400,{error:'Invalid request.'});
    if(body.value?.confirm!==true)return managementJson(400,{error:'Explicit confirmation is required.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear management database is not configured.');return managementJson(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const access=await redeem(db,body.value?.token,now());
      if(!access)return managementJson(400,{error:'Access unavailable.'});
      return managementJson(200,{csrf:access.csrf,expiresAt:access.expiresAt},{'Set-Cookie':managementCookie(access.session,MANAGEMENT_TTL_MS/1000)});
    }catch(error){
      console.error('Gear management confirmation failed:',error);
      return managementJson(500,{error:'Unable to confirm listing access right now.'});
    }
  };
}

export const onRequestPost=createManagementConfirmHandler();
