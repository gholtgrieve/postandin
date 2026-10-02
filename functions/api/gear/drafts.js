import {createDraft} from '../../../lib/gear-storage.mjs';
import {DraftValidationError,validateDraft} from '../../../lib/gear-validation.mjs';
import {GearTurnstileRejectedError,GearTurnstileUnavailableError,verifyGearPostTurnstile} from '../../../lib/gear-turnstile.mjs';
import {managementJson as json,managementRequestError as requestError,managementRequestJson as requestJson} from '../../../lib/gear-management-http.mjs';
import {issueDraftPhotoAccess} from '../../../lib/gear-draft-photos.mjs';

const BODY_MAX_BYTES=24*1024;

export function createDraftSubmissionHandler({verify=verifyGearPostTurnstile,create=createDraft,issuePhotoAccess=issueDraftPhotoAccess,now=Date.now}={}){
  return async function draftSubmission(context){
    const invalidRequest=requestError(context.request,context.env);if(invalidRequest)return invalidRequest;
    const body=await requestJson(context.request,BODY_MAX_BYTES);
    if(body.tooLarge)return json(413,{error:'Request too large.'});
    if(body.invalid)return json(400,{error:'Invalid request.'});
    const listing=body.value?.listing,turnstileToken=body.value?.turnstileToken;
    try{validateDraft(listing);}catch(error){
      if(error instanceof DraftValidationError)return json(400,{error:error.message,fields:error.fields});
      throw error;
    }
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear posting database is not configured.');return json(503,{error:'Listing submission is temporarily unavailable.'});}
    try{await verify(turnstileToken,context.env);}
    catch(error){
      if(error instanceof GearTurnstileRejectedError){if(error.diagnostic)console.warn('Gear posting verification rejected due to a configuration or request mismatch.');return json(400,{error:'Complete the verification and try again.'});}
      if(error instanceof GearTurnstileUnavailableError){console.error('Gear posting verification is unavailable.');return json(503,{error:'Listing submission is temporarily unavailable.'});}
      console.error('Gear posting verification failed unexpectedly.');return json(503,{error:'Listing submission is temporarily unavailable.'});
    }
    try{const timestamp=now(),created=await create(db,listing,timestamp),access=await issuePhotoAccess(db,created.id,timestamp);if(!access)throw new Error('Draft photo access unavailable.');return json(201,{...created,photoToken:access.token});}
    catch(error){
      if(error instanceof DraftValidationError)return json(400,{error:error.message,fields:error.fields});
      console.error('Gear draft creation failed.');return json(500,{error:'Unable to save this listing right now.'});
    }
  };
}

export const onRequestPost=createDraftSubmissionHandler();
