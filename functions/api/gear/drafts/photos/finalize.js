import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson} from '../../../../../lib/gear-management-http.mjs';
import {attachClaimedDraftPhoto,claimDraftPhotoQuarantine,hasDraftPhotoAccess} from '../../../../../lib/gear-draft-photos.mjs';
import {discardClaimedPhoto,queuePhotoDeletionIfUnattached,queuePhotoDeletions,releasePhotoQuarantine} from '../../../../../lib/gear-photo-quarantine.mjs';
import {sanitizeGearPhoto} from '../../../../../lib/gear-pages-photo-service.mjs';

const TOKEN=/^[0-9a-f]{64}$/;
function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&isGearImageProviderId(value.quarantineProviderId)&&TOKEN.test(value.draftToken??'')?value:null;}

export function createDraftPhotoFinalizeHandler({access=hasDraftPhotoAccess,claim=claimDraftPhotoQuarantine,sanitize=sanitizeGearPhoto,release=releasePhotoQuarantine,attach=attachClaimedDraftPhoto,discard=discardClaimedPhoto,queue=queuePhotoDeletions,queueIfUnattached=queuePhotoDeletionIfUnattached,now=Date.now}={}){
  return async function draftPhotoFinalize(context){
    const invalid=managementRequestError(context.request,context.env);if(invalid)return invalid;
    const body=await managementRequestJson(context.request);if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a photo upload.'});
    const db=context.env?.GEAR_DB,service=context.env?.GEAR_IMAGES;
    if(!db||!service?.fetch||context.env?.GEAR_PHOTO_UPLOADS_ENABLED!=='true')return json(503,{error:'Photo processing is temporarily unavailable.'});
    const timestamp=now();let claimed;
    try{
      if(!await access(db,values.draftToken,timestamp))return json(401,{error:'Draft access unavailable.'});
      claimed=await claim(db,values.draftToken,values.quarantineProviderId,timestamp);if(!claimed)return json(409,{error:'This photo upload cannot be finalized.'});
      const discardOrQueue=async cleanup=>{if(!await discard(db,values.quarantineProviderId,claimed.claim,cleanup,timestamp))await queue(db,claimed.listingId,[values.quarantineProviderId,...cleanup],timestamp);};
      const processed=await sanitize(service,values.quarantineProviderId);
      if(processed.kind==='pending'||processed.kind==='unavailable'){
        if(processed.cleanupProviderIds?.length)await queue(db,claimed.listingId,processed.cleanupProviderIds,timestamp);await release(db,values.quarantineProviderId,claimed.claim,timestamp);
        return json(processed.kind==='pending'?409:503,{error:processed.kind==='pending'?'Photo upload is still in progress.':'Photo processing is temporarily unavailable.'});
      }
      if(processed.kind==='rejected'){await discardOrQueue(processed.cleanupProviderIds);return json(422,{error:'This photo could not be accepted.'});}
      let attached;try{attached=await attach(db,values.draftToken,values.quarantineProviderId,claimed.claim,processed.providerId,timestamp);}catch(firstError){
        try{attached=await attach(db,values.draftToken,values.quarantineProviderId,claimed.claim,processed.providerId,timestamp);}catch(secondError){
          try{await queueIfUnattached(db,claimed.listingId,processed.providerId,timestamp);}catch{}return json(500,{error:'Unable to attach this photo right now.'});
        }
      }
      if((attached?.ok||attached?.reason==='attached')&&isGearImageProviderId(attached.photoId)){if(processed.cleanupProviderIds.length)try{await queue(db,claimed.listingId,processed.cleanupProviderIds,timestamp);}catch{}return json(200,{ok:true,photoId:attached.photoId});}
      await discardOrQueue([processed.providerId,...(attached?.cleanupProviderIds??[])]);return json(409,{error:'This photo can no longer be attached.'});
    }catch(error){console.error('Gear draft photo finalize failed.',error);if(claimed)try{await release(db,values.quarantineProviderId,claimed.claim,timestamp);}catch{}return json(500,{error:'Unable to process this photo right now.'});}
  };
}

export const onRequestPost=createDraftPhotoFinalizeHandler();
