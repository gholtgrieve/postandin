import {createGearPhotoSigner,gearPhotoDeliveryConfig} from '../../../../lib/gear-photo-delivery.mjs';
import {readManagedSnapshotWithPhotoRefs} from '../../../../lib/gear-management.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../lib/gear-management-http.mjs';

const empty=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0;

export function createManagementListingsHandler({read=readManagedSnapshotWithPhotoRefs,signer=createGearPhotoSigner,now=Date.now}={}){
  return async function managementListings(context){
    const requestError=managementRequestError(context.request);if(requestError)return requestError;
    const session=managementSession(context.request);if(!session)return json(401,{error:'Access unavailable.'});
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid||!empty(body.value))return json(400,{error:'Invalid request.'});
    const db=context.env?.GEAR_DB,config=gearPhotoDeliveryConfig(context.env);
    if(!db||!config){console.error('Gear management listings bindings are not configured.');return json(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const timestamp=now(),snapshot=await read(db,session,timestamp);if(!snapshot)return json(401,{error:'Access unavailable.'});
      const sign=await signer(config,timestamp),listings=[];
      for(const {photoRefs,...row} of snapshot.listings)listings.push({...row,photos:await sign(photoRefs)});
      return json(200,{listings,deleted:snapshot.deleted});
    }catch(error){console.error('Gear management listings request failed.',error);return json(500,{error:'Unable to load your listings right now.'});}
  };
}

export const onRequestPost=createManagementListingsHandler();
