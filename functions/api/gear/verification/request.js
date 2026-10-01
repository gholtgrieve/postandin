import {managementJson as json,managementRequestError as requestError,managementRequestJson as requestJson} from '../../../../lib/gear-management-http.mjs';
import {issueVerification,releaseFailedVerificationIssue} from '../../../../lib/gear-verification.mjs';
import {GearVerificationMailUnavailableError,sendVerificationLink,verificationMailConfigured} from '../../../../lib/gear-verification-mail.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function createVerificationRequestHandler({issue=issueVerification,release=releaseFailedVerificationIssue,send=sendVerificationLink,configured=verificationMailConfigured,now=Date.now}={}){
  return async function verificationRequest(context){
    const invalidRequest=requestError(context.request,context.env);if(invalidRequest)return invalidRequest;
    const body=await requestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid||!UUID.test(body.value?.id??''))return json(400,{error:'Invalid request.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear verification database is not configured.');return json(503,{error:'Email verification is temporarily unavailable.'});}
    if(!configured(context.env)){console.error('Gear verification mail is not configured.');return json(503,{error:'Email verification is temporarily unavailable.'});}
    let receipt;
    try{
      receipt=await issue(db,body.value.id,now());
      if(!receipt)return json(404,{error:'This draft is no longer available for verification.'});
      if(receipt.limited){
        const headers=receipt.retryAfterSeconds?{'Retry-After':String(receipt.retryAfterSeconds)}:{};
        return json(429,{error:receipt.reason==='cap'?'Verification email limit reached for this draft. Check your inbox.':'Check your inbox or try again in a minute.'},headers);
      }
      await send(receipt,context.env);
      return json(202,{message:'Verification email accepted for delivery.'});
    }catch(error){
      if(error instanceof GearVerificationMailUnavailableError){
        if(receipt?.token&&error.releasable){
          try{if(!await release(db,body.value.id,receipt.token,now()))console.error('Gear verification delivery rollback lost its token race.');}
          catch{console.error('Gear verification delivery rollback failed.');}
        }
        console.error('Gear verification email delivery failed:',error.code);
      }
      else console.error('Gear verification request failed unexpectedly.');
      return json(503,{error:'Unable to send the verification email right now. Your draft is saved; please try again.'});
    }
  };
}

export const onRequestPost=createVerificationRequestHandler();
