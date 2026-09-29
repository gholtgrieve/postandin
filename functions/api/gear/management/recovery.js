import {issueManagementLink} from '../../../../lib/gear-management.mjs';
import {managementJson,managementRequestError,managementRequestJson} from '../../../../lib/gear-management-http.mjs';
import {GearManagementMailUnavailableError,sendManagementLink,validateManagementEmail} from '../../../../lib/gear-management-mail.mjs';

const accepted=()=>managementJson(202,{message:'If verified listings match that address, a management link will be sent.'});

export function createManagementRecoveryHandler({issue=issueManagementLink,send=sendManagementLink,now=Date.now,log=console.error}={}){
  return async function managementRecovery(context){
    const requestError=managementRequestError(context.request);if(requestError)return requestError;
    const body=await managementRequestJson(context.request);
    if(body.tooLarge)return managementJson(413,{error:'Request too large.'});
    if(body.invalid)return managementJson(400,{error:'Invalid request.'});
    const email=validateManagementEmail(body.value?.email);
    if(!email)return managementJson(400,{error:'Enter a valid email address.'});
    const db=context.env?.GEAR_DB;
    if(!db){console.error('Gear management database is not configured.');return managementJson(503,{error:'Listing management is temporarily unavailable.'});}
    try{
      const receipt=await issue(db,email,now());
      if(receipt){
        const delivery=Promise.resolve().then(()=>send(receipt,context.env)).catch(error=>log('Gear management email delivery failed:',error instanceof GearManagementMailUnavailableError?error.code:'unexpected'));
        if(typeof context.waitUntil==='function')context.waitUntil(delivery);else await delivery;
      }
      return accepted();
    }catch(error){
      console.error('Gear management recovery request failed:',error);
      return managementJson(500,{error:'Unable to request listing access right now.'});
    }
  };
}

export const onRequestPost=createManagementRecoveryHandler();
