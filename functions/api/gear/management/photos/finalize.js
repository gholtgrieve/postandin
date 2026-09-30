import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../../lib/gear-management-http.mjs';
import {attachClaimedPhoto,claimPhotoQuarantine,discardClaimedPhoto,hasPhotoManagementAccess,queuePhotoDeletionIfUnattached,queuePhotoDeletions,releasePhotoQuarantine} from '../../../../../lib/gear-photo-quarantine.mjs';
import {sanitizeGearPhoto} from '../../../../../lib/gear-pages-photo-service.mjs';

function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&isGearImageProviderId(value.quarantineProviderId)?value:null;}

export function createGearPhotoFinalizeHandler({access=hasPhotoManagementAccess,claim=claimPhotoQuarantine,sanitize=sanitizeGearPhoto,release=releasePhotoQuarantine,attach=attachClaimedPhoto,discard=discardClaimedPhoto,queue=queuePhotoDeletions,queueIfUnattached=queuePhotoDeletionIfUnattached,now=Date.now}={}){
  return async function gearPhotoFinalize(context){
    const requestError=managementRequestError(context.request);if(requestError)return requestError;
    const session=managementSession(context.request);if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a photo upload.'});
    const db=context.env?.GEAR_DB,service=context.env?.GEAR_IMAGES;
    if(!db||!service?.fetch||context.env?.GEAR_PHOTO_UPLOADS_ENABLED!=='true'){console.error('Gear photo finalize bindings are not configured.');return json(503,{error:'Photo processing is temporarily unavailable.'});}
    const timestamp=now();let claimed;
    try{
      if(!await access(db,session,csrf,timestamp))return json(401,{error:'Access unavailable.'});
      claimed=await claim(db,session,csrf,values.quarantineProviderId,timestamp);
      if(!claimed)return json(409,{error:'This photo upload cannot be finalized.'});
      const discardOrQueue=async cleanup=>{
        if(!await discard(db,values.quarantineProviderId,claimed.claim,cleanup,timestamp)){
          await queue(db,claimed.listingId,[values.quarantineProviderId,...cleanup],timestamp);
        }
      };
      const processed=await sanitize(service,values.quarantineProviderId);
      if(processed.kind==='pending'||processed.kind==='unavailable'){
        if(processed.cleanupProviderIds?.length)await queue(db,claimed.listingId,processed.cleanupProviderIds,timestamp);
        await release(db,values.quarantineProviderId,claimed.claim,timestamp);
        return json(processed.kind==='pending'?409:503,{error:processed.kind==='pending'?'Photo upload is still in progress.':'Photo processing is temporarily unavailable.'});
      }
      if(processed.kind==='rejected'){
        await discardOrQueue(processed.cleanupProviderIds);
        return json(422,{error:'This photo could not be accepted.'});
      }
      let attached;
      try{attached=await attach(db,session,csrf,values.quarantineProviderId,claimed.claim,processed.providerId,timestamp);}
      catch(firstError){
        console.error('Gear photo attachment retry required.',firstError);
        try{attached=await attach(db,session,csrf,values.quarantineProviderId,claimed.claim,processed.providerId,timestamp);}
        catch(secondError){
          console.error('Gear photo attachment retry failed.',secondError);
          try{await queueIfUnattached(db,claimed.listingId,processed.providerId,timestamp);}catch(queueError){console.error('Gear photo attachment cleanup fallback failed.',queueError);}
          return json(500,{error:'Unable to attach this photo right now.'});
        }
      }
      if(attached?.ok||attached?.reason==='attached'){
        if(processed.cleanupProviderIds.length)try{await queue(db,claimed.listingId,processed.cleanupProviderIds,timestamp);}catch(error){console.error('Gear photo cleanup staging failed.',error);}
        return json(200,{ok:true});
      }
      const cleanup=[processed.providerId,...(attached?.cleanupProviderIds??[])];
      await discardOrQueue(cleanup);
      return json(409,{error:'This photo can no longer be attached.'});
    }catch(error){
      console.error('Gear photo finalize request failed.',error);
      if(claimed)try{await release(db,values.quarantineProviderId,claimed.claim,timestamp);}catch{}
      return json(500,{error:'Unable to process this photo right now.'});
    }
  };
}

export const onRequestPost=createGearPhotoFinalizeHandler();
