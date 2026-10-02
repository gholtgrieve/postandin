import {isGearImageProviderId} from '../../../../lib/gear-image-provider-id.mjs';
import {changeListingState,editManagedListing,recoverManagementSession} from '../../../../lib/gear-management.mjs';
import {managementJson as json,managementRequestError,managementRequestJson,managementSession} from '../../../../lib/gear-management-http.mjs';
import {DraftValidationError} from '../../../../lib/gear-validation.mjs';

const BODY_MAX_BYTES=24*1024;
function input(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!isGearImageProviderId(value.id))return null;
  if(value.action==='edit'&&Object.keys(value).length===3&&value.listing&&typeof value.listing==='object'&&!Array.isArray(value.listing))return value;
  return ['pending','available','relist'].includes(value.action)&&Object.keys(value).length===2?value:null;
}

export function createManagementListingHandler({recover=recoverManagementSession,edit=editManagedListing,change=changeListingState,now=Date.now}={}){
  return async function managementListing(context){
    const requestError=managementRequestError(context.request,context.env);if(requestError)return requestError;
    const session=managementSession(context.request);if(!session)return json(401,{error:'Access unavailable.'});
    const csrf=context.request.headers.get('x-gear-csrf')??'';if(!csrf)return json(403,{error:'Request not allowed.'});
    const body=await managementRequestJson(context.request,BODY_MAX_BYTES);
    if(body.tooLarge)return json(413,{error:'Request too large.'});if(body.invalid)return json(400,{error:'Invalid request.'});
    const values=input(body.value);if(!values)return json(400,{error:'Choose a listing and action.'});
    const db=context.env?.GEAR_DB;if(!db){console.error('Gear management listing database is not configured.');return json(503,{error:'Listing management is temporarily unavailable.'});}
    const timestamp=now();
    try{
      const access=await recover(db,session,timestamp);
      if(!access)return json(401,{error:'Access unavailable.'});
      if(csrf!==access.csrf)return json(403,{error:'Request not allowed.'});
      const changed=values.action==='edit'
        ?await edit(db,session,csrf,values.id,values.listing,timestamp)
        :await change(db,session,csrf,values.id,values.action,timestamp);
      if(changed)return json(200,{ok:true});
      return await recover(db,session,timestamp)
        ?json(409,{error:'This listing could not be changed. Refresh your listings and try again.'})
        :json(401,{error:'Access unavailable.'});
    }catch(error){
      if(error instanceof DraftValidationError)return json(400,{error:error.message,fields:error.fields});
      console.error('Gear management listing request failed.',error);return json(500,{error:'Unable to change this listing right now.'});
    }
  };
}

export const onRequestPost=createManagementListingHandler();
