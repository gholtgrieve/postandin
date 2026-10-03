import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson} from '../../../../../lib/gear-management-http.mjs';
import {hasDraftListingAccess,reorderDraftPhotos} from '../../../../../lib/gear-draft-photos.mjs';

const TOKEN=/^[0-9a-f]{64}$/;
function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3
  &&isGearImageProviderId(value.listingId)&&TOKEN.test(value.draftToken??'')&&Array.isArray(value.photoIds)
  &&value.photoIds.length<=6&&new Set(value.photoIds).size===value.photoIds.length
  &&value.photoIds.every(isGearImageProviderId)?value:null;}

export function createDraftPhotoReorderHandler({access=hasDraftListingAccess,reorder=reorderDraftPhotos,now=Date.now}={}){
  return async function draftPhotoReorder(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const body=await managementRequestJson(context.request);if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a valid draft photo order.'});
    const db=context.env?.GEAR_DB;if(!db)return json(503,{error:'Photo management is temporarily unavailable.'});
    const timestamp=now();
    try{
      if(!await access(db,values.draftToken,values.listingId,timestamp))return json(401,{error:'Draft access unavailable.'});
      if(!await reorder(db,values.draftToken,values.listingId,values.photoIds,timestamp))return json(409,{error:'The photo order changed. Try again.'});
      return json(200,{ok:true});
    }catch(error){console.error('Gear draft photo reorder failed.',error);return json(500,{error:'Unable to reorder photos right now.'});}
  };
}

export const onRequestPost=createDraftPhotoReorderHandler();
