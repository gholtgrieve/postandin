import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../../lib/gear-management-http.mjs';
import {canRecordPhotoQuarantine,hasPhotoManagementAccess,queuePhotoDeletions,recordPhotoQuarantine} from '../../../../../lib/gear-photo-quarantine.mjs';
import {createGearPhotoUpload,deleteGearPhotoImmediately} from '../../../../../lib/gear-pages-photo-service.mjs';

function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&isGearImageProviderId(value.listingId)?value:null;}

export function createGearPhotoUploadHandler({access=hasPhotoManagementAccess,preflight=canRecordPhotoQuarantine,create=createGearPhotoUpload,record=recordPhotoQuarantine,remove=deleteGearPhotoImmediately,queue=queuePhotoDeletions,now=Date.now}={}){
  return async function gearPhotoUpload(context){
    const requestError=managementRequestError(context.request);if(requestError)return requestError;
    const session=managementSession(context.request);if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a listing.'});
    const db=context.env?.GEAR_DB,service=context.env?.GEAR_IMAGES;
    if(!db||!service?.fetch||context.env?.GEAR_PHOTO_UPLOADS_ENABLED!=='true'){console.error('Gear photo upload bindings are not configured.');return json(503,{error:'Photo uploads are temporarily unavailable.'});}
    const timestamp=now();
    try{
      if(!await access(db,session,csrf,timestamp))return json(401,{error:'Access unavailable.'});
      if(!await preflight(db,session,csrf,values.listingId,timestamp))return json(409,{error:'This listing cannot accept another photo.'});
      const created=await create(service);
      if(created.cleanupProviderIds?.length)await queue(db,values.listingId,created.cleanupProviderIds,timestamp);
      if(created.kind!=='created')return json(503,{error:'Photo uploads are temporarily unavailable.'});
      let reserved,recordFailed=false;
      try{reserved=await record(db,session,csrf,values.listingId,created.quarantineProviderId,timestamp);}catch(error){recordFailed=true;console.error('Gear photo quarantine reservation failed.',error);}
      if(!reserved){
        if(!await remove(service,created.quarantineProviderId))await queue(db,values.listingId,[created.quarantineProviderId],timestamp);
        return recordFailed?json(500,{error:'Unable to prepare this photo right now.'}):json(409,{error:'This listing cannot accept another photo.'});
      }
      return json(201,{quarantineProviderId:created.quarantineProviderId,uploadURL:created.uploadURL,expiresAt:reserved.expiresAt});
    }catch(error){console.error('Gear photo upload request failed.',error);return json(500,{error:'Unable to prepare this photo right now.'});}
  };
}

export const onRequestPost=createGearPhotoUploadHandler();
