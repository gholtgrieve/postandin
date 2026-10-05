import {managementJson as json,managementRequestError as requestError,managementRequestJson as requestJson} from '../../../../lib/gear-management-http.mjs';
import {issuePostVerificationManagementLink} from '../../../../lib/gear-management.mjs';
import {GearManagementMailUnavailableError,sendManagementLink} from '../../../../lib/gear-management-mail.mjs';
import {confirmProductionVerification} from '../../../../lib/gear-verification.mjs';

export function createVerificationConfirmHandler({confirm=confirmProductionVerification,issue=issuePostVerificationManagementLink,send=sendManagementLink,now=Date.now,log=console.error}={}){
  return async function verificationConfirm(context){
    const invalidRequest=requestError(context.request,context.env);if(invalidRequest)return invalidRequest;
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    if(body.value?.confirm!==true)return json(400,{error:'Explicit confirmation is required.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear verification database is not configured.');return json(503,{error:'Email verification is temporarily unavailable.'});}
    try{
      const confirmedAt=now(),result=await confirm(db,body.value?.token,confirmedAt);
      if(!result.verified)return json(400,{error:'Verification unavailable. The link may have expired or the listing may conflict with an active listing.'});
      if(!result.alreadyVerified){
        try{
          const receipt=await issue(db,result.listingId,confirmedAt);
          if(receipt){
            const delivery=Promise.resolve().then(()=>send(receipt,context.env)).catch(error=>log('Gear post-verification management email delivery failed:',error instanceof GearManagementMailUnavailableError?error.code:'unexpected'));
            if(typeof context.waitUntil==='function')context.waitUntil(delivery);else await delivery;
          }else log('Gear post-verification management link was not issued.');
        }catch{log('Gear post-verification management link issuance failed.');}
      }
      return json(200,result);
    }catch(error){
      console.error('Gear verification confirmation failed.');
      return json(500,{error:'Unable to verify this listing right now.'});
    }
  };
}

export const onRequestPost=createVerificationConfirmHandler();
