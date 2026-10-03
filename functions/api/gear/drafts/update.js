import {hasDraftListingAccess} from '../../../../lib/gear-draft-photos.mjs';
import {updateDraft} from '../../../../lib/gear-storage.mjs';
import {DraftValidationError,validateDraft} from '../../../../lib/gear-validation.mjs';
import {managementJson as json,managementRequestError,managementRequestJson} from '../../../../lib/gear-management-http.mjs';
import {isGearImageProviderId} from '../../../../lib/gear-image-provider-id.mjs';

const BODY_MAX_BYTES=24*1024;
const TOKEN=/^[0-9a-f]{64}$/;
function input(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3
    &&isGearImageProviderId(value.listingId)&&TOKEN.test(value.draftToken??'')
    &&value.listing&&typeof value.listing==='object'&&!Array.isArray(value.listing)?value:null;
}

export function createDraftUpdateHandler({access=hasDraftListingAccess,update=updateDraft,now=Date.now}={}){
  return async function draftUpdate(context){
    const invalid=managementRequestError(context.request,context.env);if(invalid)return invalid;
    const body=await managementRequestJson(context.request,BODY_MAX_BYTES);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a draft listing.'});
    try{validateDraft(values.listing);}catch(error){if(error instanceof DraftValidationError)return json(400,{error:error.message,fields:error.fields});throw error;}
    const db=context.env?.GEAR_DB;if(!db)return json(503,{error:'Listing submission is temporarily unavailable.'});
    try{
      const timestamp=now();
      if(!await access(db,values.draftToken,values.listingId,timestamp))return json(401,{error:'Draft access unavailable.'});
      return await update(db,values.listingId,values.listing,timestamp)?json(200,{ok:true}):json(409,{error:'This draft could not be updated.'});
    }catch(error){
      if(error instanceof DraftValidationError)return json(400,{error:error.message,fields:error.fields});
      console.error('Gear draft update failed.');return json(500,{error:'Unable to save this listing right now.'});
    }
  };
}

export const onRequestPost=createDraftUpdateHandler();
