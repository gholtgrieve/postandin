import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson} from '../../../../../lib/gear-management-http.mjs';
import {canRecordDraftPhoto,consumeDraftPhotoUpload,hasDraftPhotoAccess,recordDraftPhotoQuarantine} from '../../../../../lib/gear-draft-photos.mjs';
import {queuePhotoDeletions} from '../../../../../lib/gear-photo-quarantine.mjs';
import {createGearPhotoUpload,deleteGearPhotoImmediately} from '../../../../../lib/gear-pages-photo-service.mjs';

const TOKEN=/^[0-9a-f]{64}$/;
function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&isGearImageProviderId(value.listingId)&&TOKEN.test(value.draftToken??'')?value:null;}

export function createDraftPhotoUploadHandler({access=hasDraftPhotoAccess,preflight=canRecordDraftPhoto,consume=consumeDraftPhotoUpload,create=createGearPhotoUpload,record=recordDraftPhotoQuarantine,remove=deleteGearPhotoImmediately,queue=queuePhotoDeletions,now=Date.now}={}){
  return async function draftPhotoUpload(context){
    const invalid=managementRequestError(context.request,context.env);if(invalid)return invalid;
    const body=await managementRequestJson(context.request);if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a listing.'});
    const db=context.env?.GEAR_DB,service=context.env?.GEAR_IMAGES;
    if(!db||!service?.fetch||context.env?.GEAR_PHOTO_UPLOADS_ENABLED!=='true')return json(503,{error:'Photo uploads are temporarily unavailable.'});
    const timestamp=now();
    try{
      if(!await access(db,values.draftToken,timestamp))return json(401,{error:'Draft access unavailable.'});
      if(!await preflight(db,values.draftToken,values.listingId,timestamp))return json(409,{error:'This listing cannot accept another photo.'});
      const budget=await consume(db,values.draftToken,values.listingId,timestamp);
      if(!budget?.allowed)return json(budget?.reason==='limited'?429:409,{error:budget?.reason==='limited'?'Too many photo uploads. Try again later.':'This listing cannot accept another photo.'},budget?.reason==='limited'?{'Retry-After':String(budget.retryAfterSeconds??60)}:{});
      const created=await create(service);if(created.cleanupProviderIds?.length)await queue(db,values.listingId,created.cleanupProviderIds,timestamp);
      if(created.kind!=='created')return json(503,{error:'Photo uploads are temporarily unavailable.'});
      let reserved;try{reserved=await record(db,values.draftToken,values.listingId,created.quarantineProviderId,timestamp);}catch(error){console.error('Gear draft photo reservation failed.',error);}
      if(!reserved){if(!await remove(service,created.quarantineProviderId))await queue(db,values.listingId,[created.quarantineProviderId],timestamp);return json(409,{error:'This listing cannot accept another photo.'});}
      return json(201,{quarantineProviderId:created.quarantineProviderId,uploadURL:created.uploadURL,expiresAt:reserved.expiresAt});
    }catch(error){console.error('Gear draft photo upload failed.',error);return json(500,{error:'Unable to prepare this photo right now.'});}
  };
}

export const onRequestPost=createDraftPhotoUploadHandler();
