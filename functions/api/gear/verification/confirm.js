import {managementJson as json,managementRequestError as requestError,managementRequestJson as requestJson} from '../../../../lib/gear-management-http.mjs';
import {confirmProductionVerification} from '../../../../lib/gear-verification.mjs';

export function createVerificationConfirmHandler({confirm=confirmProductionVerification,now=Date.now}={}){
  return async function verificationConfirm(context){
    const invalidRequest=requestError(context.request);if(invalidRequest)return invalidRequest;
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    if(body.value?.confirm!==true)return json(400,{error:'Explicit confirmation is required.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear verification database is not configured.');return json(503,{error:'Email verification is temporarily unavailable.'});}
    try{
      const result=await confirm(db,body.value?.token,now());
      if(!result.verified)return json(400,{error:'Verification unavailable. The link may have expired or the listing may conflict with an active listing.'});
      return json(200,result);
    }catch(error){
      console.error('Gear verification confirmation failed.');
      return json(500,{error:'Unable to verify this listing right now.'});
    }
  };
}

export const onRequestPost=createVerificationConfirmHandler();
