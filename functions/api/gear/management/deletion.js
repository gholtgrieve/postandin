import {changeSellerDeletion,validateSellerDeletionAction} from '../../../../lib/gear-seller-deletion.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../lib/gear-management-http.mjs';

export function createSellerDeletionHandler({change=changeSellerDeletion,now=Date.now}={}){
  return async function sellerDeletion(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const session=managementSession(context.request);
    if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';
    if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request);
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
