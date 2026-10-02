import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson} from '../../../../../lib/gear-management-http.mjs';
import {hasDraftListingAccess,removeDraftPhoto} from '../../../../../lib/gear-draft-photos.mjs';

const TOKEN=/^[0-9a-f]{64}$/;
function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3
  &&isGearImageProviderId(value.listingId)&&isGearImageProviderId(value.photoId)&&TOKEN.test(value.draftToken??'')?value:null;}

export function createDraftPhotoRemoveHandler({access=hasDraftListingAccess,remove=removeDraftPhoto,now=Date.now}={}){
  return async function draftPhotoRemove(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const body=await managementRequestJson(context.request);if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a draft photo.'});
    const db=context.env?.GEAR_DB;if(!db)return json(503,{error:'Photo management is temporarily unavailable.'});
    const timestamp=now();
    try{
      if(!await access(db,values.draftToken,values.listingId,timestamp))return json(401,{error:'Draft access unavailable.'});
      if(!await remove(db,values.draftToken,values.listingId,values.photoId,timestamp))return json(409,{error:'This photo could not be removed.'});
      return json(200,{ok:true});
    }catch(error){console.error('Gear draft photo removal failed.',error);return json(500,{error:'Unable to remove this photo right now.'});}
  };
}

export const onRequestPost=createDraftPhotoRemoveHandler();
