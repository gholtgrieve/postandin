import {isGearImageProviderId} from '../lib/gear-image-provider-id.mjs';

const TOKEN=/^[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES=64*1024;
const MAX_PHOTO_BYTES=5*1024*1024;
const PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp']);

export function safeError(message,status=0,fields=null){return Object.assign(new Error(message),{safe:true,status,fields});}

// Read once and erase before any network work so credentials never remain in
// copied URLs, browser history entries or later same-document navigation.
export function takeManagementToken(locationValue=location,historyValue=history){
  if(!locationValue.hash.startsWith('#management='))return null;
  const value=locationValue.hash.slice('#management='.length);
  historyValue.replaceState(historyValue.state,'',locationValue.pathname+locationValue.search);
  return TOKEN.test(value)?value:null;
}

async function responseJson(response){
  const text=await response.text();
  if(text.length>MAX_RESPONSE_BYTES)throw safeError('The server returned an unreadable response. Please try again.');
  let result;try{result=JSON.parse(text);}catch{throw safeError('The server returned an unreadable response. Please try again.');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw safeError('The server returned an unreadable response. Please try again.');
  if(!response.ok)throw safeError(response.status===401?'Your session has ended. Request a new management link.':result.error||'Unable to complete this request.',response.status,result.fields);
  return result;
}

export function productionAPI({fetcher=fetch,origin=location.origin,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(origin!=='https://postandin.com')throw safeError('Production listing management requires postandin.com.');
  async function request(path,body={},csrf=''){
    let response;
    try{response=await fetcher('/api/gear'+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:JSON.stringify(body)});}
    catch{throw safeError('The request could not be confirmed. Check the connection and try again.');}
    return responseJson(response);
  }
  const session=()=>request('/management/session');
  async function authenticated(path,body){const access=await session();return request(path,body,access.csrf);}
  async function uploadPhoto(listingId,file){
    if(!file||!PHOTO_TYPES.has(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_PHOTO_BYTES)throw safeError('Choose a JPG, PNG, or WebP image up to 5 MB.');
    const created=await authenticated('/management/photos/upload',{listingId});
    if(!isGearImageProviderId(created.quarantineProviderId)||typeof created.uploadURL!=='string')throw safeError('The server returned an unreadable response. Please try again.');
    let uploadURL;try{uploadURL=new URL(created.uploadURL);}catch{throw safeError('The server returned an unreadable response. Please try again.');}
    if(uploadURL.protocol!=='https:'||uploadURL.hostname!=='upload.imagedelivery.net')throw safeError('The server returned an unreadable response. Please try again.');
    const form=new FormData();form.append('file',file,'gear-photo');
    let uploaded;try{uploaded=await fetcher(uploadURL.href,{method:'POST',body:form,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw safeError('The photo could not be uploaded. Please try again.');}
    if(!uploaded.ok)throw safeError('The photo could not be uploaded. Please try again.');
    for(let attempt=0;attempt<4;attempt++){
      try{return await authenticated('/management/photos/finalize',{quarantineProviderId:created.quarantineProviderId});}
      catch(error){
        if(error.status!==409||error.message!=='Photo upload is still in progress.')throw error;
        if(attempt===3)throw safeError('The photo is still processing and was not attached. Wait a minute, then upload it again.',409);
        await wait(1000);
      }
    }
  }
  return {
    request,session,uploadPhoto,
    confirm:token=>request('/management/confirm',{token,confirm:true}),
    recover:email=>request('/management/recovery',{email}),
    write:body=>authenticated('/management/listing',body),
    deletion:body=>authenticated('/management/deletion',body),
    removePhoto:(listingId,photoId)=>authenticated('/management/photos/remove',{listingId,photoId}),
    reorderPhotos:(listingId,photoIds)=>authenticated('/management/photos/reorder',{listingId,photoIds}),
    logout:()=>authenticated('/management/logout',{}),
  };
}

export function previewListing(row){return {...row,type:row.type==='sale'?'Sale':row.type==='free'?'Free':'Trade',seller:row.sellerName,place:row.city,photos:row.photos||[],age:'',pending:row.status==='pending',status:row.status[0].toUpperCase()+row.status.slice(1),expires:row.expiresAt};}
export function listingInput(d){return {title:d.title,description:d.description,category:d.category,size:d.size,fit:d.fit,condition:d.condition,city:d.city,type:d.type.toLowerCase(),priceCents:d.priceCents,trade:d.trade,clubs:d.clubs,otherClub:d.otherClub,sellerName:d.seller};}
