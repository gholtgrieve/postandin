import {isGearImageProviderId} from '../../../../../lib/gear-image-provider-id.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../../lib/gear-management-http.mjs';
import {hasPhotoManagementAccess} from '../../../../../lib/gear-photo-quarantine.mjs';
import {removeManagedPhoto} from '../../../../../lib/gear-photo-management.mjs';

function input(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2
  &&isGearImageProviderId(value.listingId)&&isGearImageProviderId(value.photoId)?value:null;}

export function createGearPhotoRemoveHandler({access=hasPhotoManagementAccess,remove=removeManagedPhoto,now=Date.now}={}){
  return async function gearPhotoRemove(context){
    const requestError=managementRequestError(context.request);if(requestError)return requestError;
    const session=managementSession(context.request);if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a photo.'});
    const db=context.env?.GEAR_DB;if(!db){console.error('Gear photo removal database is not configured.');return json(503,{error:'Photo management is temporarily unavailable.'});}
    const timestamp=now();
    try{
      if(!await access(db,session,csrf,timestamp))return json(401,{error:'Access unavailable.'});
      if(!await remove(db,session,csrf,values.listingId,values.photoId,timestamp))return json(409,{error:'This photo could not be removed.'});
      return json(200,{ok:true});
    }catch(error){console.error('Gear photo removal failed.',error);return json(500,{error:'Unable to remove this photo right now.'});}
  };
}

export const onRequestPost=createGearPhotoRemoveHandler();
