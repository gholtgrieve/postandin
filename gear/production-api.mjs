import {isGearImageProviderId} from '../lib/gear-image-provider-id.mjs';
import {CATEGORIES,SIZES,CONDITIONS,CLUBS,LISTING_TYPES,LIMITS} from '../lib/gear-exchange.mjs';
import {isGearPublicOrigin} from '../lib/gear-origins.mjs';

const TOKEN=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SITE_KEY=/^[\x21-\x7e]{1,128}$/;
const MAX_RESPONSE_BYTES=64*1024;
const MAX_PUBLIC_RESPONSE_BYTES=2*1024*1024;
const MAX_PHOTO_BYTES=10_000_000;
const PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const PHOTO_NAME=/\.(?:jpe?g|png|webp|heic|heif)$/i;

export function safeError(message,status=0,fields=null){return Object.assign(new Error(message),{safe:true,status,fields});}

export async function preparePhoto(file,{createBitmap=globalThis.createImageBitmap,createCanvas=()=>globalThis.document?.createElement('canvas')}={}){
  if(!file||file.size<=MAX_PHOTO_BYTES)return file;
  if(typeof createBitmap!=='function')throw safeError(`${file.name} is too large to prepare in this browser.`);
  let bitmap;
  try{bitmap=await createBitmap(file,{imageOrientation:'from-image'});}catch{throw safeError(`${file.name} could not be prepared. Try a different photo.`);}
  try{
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
    const canvas=createCanvas();if(!canvas?.getContext||!canvas?.toBlob)throw new Error();
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error();context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
    if(!blob||blob.size<1||blob.size>MAX_PHOTO_BYTES)throw new Error();
    const name=file.name.replace(/\.[^.]+$/, '')+'.jpg';return new File([blob],name,{type:'image/jpeg',lastModified:file.lastModified});
  }catch{throw safeError(`${file.name} could not be prepared. Try a different photo.`);}
  finally{bitmap?.close?.();}
}

// Read once and erase before any network work so credentials never remain in
// copied URLs, browser history entries or later same-document navigation.
function takeLinkToken(kind,locationValue,historyValue){
  const prefix=`#${kind}=`;if(!locationValue.hash.startsWith(prefix))return null;
  const value=locationValue.hash.slice(prefix.length);
  historyValue.replaceState(historyValue.state,'',locationValue.pathname+locationValue.search);
  return TOKEN.test(value)?value:null;
}
export function takeManagementToken(locationValue=location,historyValue=history){return takeLinkToken('management',locationValue,historyValue);}
export function takeVerificationToken(locationValue=location,historyValue=history){return takeLinkToken('verification',locationValue,historyValue);}

async function responseJson(response,maxBytes=MAX_RESPONSE_BYTES){
  const retry=Number(response.headers.get('retry-after')),retryAfter=Number.isSafeInteger(retry)&&retry>0?retry:null;
  const failure=(result=null)=>{
    const fallback=response.status===401?'Your session has ended. Request a new management link.':response.status===429?'Too many requests. Wait before trying again.':response.status>=500?'This service is temporarily unavailable. Please try again later.':'Unable to complete this request.';
    const message=typeof result?.error==='string'&&result.error.length<=300?result.error:fallback;
    const fields=result?.fields&&typeof result.fields==='object'&&!Array.isArray(result.fields)?Object.fromEntries(Object.entries(result.fields).filter(([,value])=>typeof value==='string'&&value.length<=300)):null;
    return Object.assign(safeError(message,response.status,fields),{retryAfter});
  };
  let text;try{text=await response.text();}catch{if(!response.ok)throw failure();throw safeError('The server returned an unreadable response. Please try again.');}
  if(text.length>maxBytes){if(!response.ok)throw failure();throw safeError('The server returned an unreadable response. Please try again.');}
  let result;try{result=JSON.parse(text);}catch{if(!response.ok)throw failure();throw safeError('The server returned an unreadable response. Please try again.');}
  if(!result||typeof result!=='object'||Array.isArray(result)){if(!response.ok)throw failure();throw safeError('The server returned an unreadable response. Please try again.');}
  if(!response.ok)throw failure(result);
  return result;
}

export function productionAPI({fetcher=fetch,origin=location.origin,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(!isGearPublicOrigin(origin))throw safeError('Production listing management requires an approved Gear origin.');
  async function request(path,body={},csrf=''){
    let response;
    try{response=await fetcher('/api/gear'+path,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:JSON.stringify(body)});}
    catch{throw safeError('The request could not be confirmed. Check the connection and try again.');}
    return responseJson(response);
  }
  async function createDraft(listing,turnstileToken){const result=await request('/drafts',{listing,turnstileToken});if(!UUID.test(result.id??'')||result.status!=='unverified'||!TOKEN.test(result.photoToken??''))throw safeError('The server returned an unreadable response. Please try again.');return result;}
  async function confirmVerification(token){const result=await request('/verification/confirm',{token,confirm:true});if(result.verified!==true||!UUID.test(result.listingId??'')||(result.alreadyVerified!==undefined&&result.alreadyVerified!==true))throw safeError('The server returned an unreadable response. Please try again.');return result;}
  async function requestVerification(id){const result=await request('/verification/request',{id});if(typeof result.message!=='string'||result.message.length>300)throw safeError('The server returned an unreadable response. Please try again.');return result;}
  async function contact(input){const result=await request('/contact',input);if(result.ok!==true||typeof result.message!=='string'||!result.message||result.message.length>300)throw safeError('The server returned an unreadable response. Please try again.');return result;}
  async function report(input){const result=await request('/reports',input);if(result.ok!==true||typeof result.message!=='string'||!result.message||result.message.length>300)throw safeError('The server returned an unreadable response. Please try again.');return result;}
  const session=()=>request('/management/session');
  async function config(){
    let response;try{response=await fetcher('/api/gear/config',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});}
    catch{throw safeError('Gear posting is temporarily unavailable.');}
    const result=await responseJson(response);if(typeof result.turnstileSiteKey!=='string'||!SITE_KEY.test(result.turnstileSiteKey)||/\s/.test(result.turnstileSiteKey)||typeof result.contactEnabled!=='boolean'||typeof result.reportEnabled!=='boolean')throw safeError('The server returned an unreadable response. Please try again.');return result;
  }
  async function listings(){
    let response;try{response=await fetcher('/api/gear/listings',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});}
    catch{throw safeError('Unable to load Gear listings right now.');}
    const result=await responseJson(response,MAX_PUBLIC_RESPONSE_BYTES);if(!Array.isArray(result.listings)||result.listings.length>100)throw safeError('The server returned an unreadable response. Please try again.');
    try{return {listings:result.listings.map(publicListing)};}catch{throw safeError('The server returned an unreadable response. Please try again.');}
  }
  async function authenticated(path,body){const access=await session();return request(path,body,access.csrf);}
  async function uploadPhoto(listingId,file){
    const supported=file&&(PHOTO_TYPES.has(file.type)||PHOTO_NAME.test(file.name));
    if(!supported||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_PHOTO_BYTES)throw safeError('Choose a supported photo up to 10 MB.');
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
  async function uploadDraftPhoto(listingId,draftToken,file){
    const supported=file&&(PHOTO_TYPES.has(file.type)||PHOTO_NAME.test(file.name));
    if(!UUID.test(listingId??'')||!TOKEN.test(draftToken??'')||!supported||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_PHOTO_BYTES)throw safeError('Choose a supported photo up to 10 MB.');
    const created=await request('/drafts/photos/upload',{listingId,draftToken});
    if(!isGearImageProviderId(created.quarantineProviderId)||typeof created.uploadURL!=='string')throw safeError('The server returned an unreadable response. Please try again.');
    let uploadURL;try{uploadURL=new URL(created.uploadURL);}catch{throw safeError('The server returned an unreadable response. Please try again.');}
    if(uploadURL.protocol!=='https:'||uploadURL.hostname!=='upload.imagedelivery.net')throw safeError('The server returned an unreadable response. Please try again.');
    const form=new FormData();form.append('file',file,'gear-photo');
    let uploaded;try{uploaded=await fetcher(uploadURL.href,{method:'POST',body:form,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});}catch{throw safeError('The photo could not be uploaded. Please try again.');}
    if(!uploaded.ok)throw safeError('The photo could not be uploaded. Please try again.');
    for(let attempt=0;attempt<4;attempt++){
      try{return await request('/drafts/photos/finalize',{quarantineProviderId:created.quarantineProviderId,draftToken});}
      catch(error){if(error.status!==409||error.message!=='Photo upload is still in progress.')throw error;if(attempt===3)throw safeError('The photo is still processing and was not attached. Wait a minute, then upload it again.',409);await wait(1000);}
    }
  }
  return {
    request,session,config,listings,uploadPhoto,uploadDraftPhoto,
    createDraft,contact,report,
    requestVerification,
    confirmVerification,
    confirm:token=>request('/management/confirm',{token,confirm:true}),
    recover:email=>request('/management/recovery',{email}),
    write:body=>authenticated('/management/listing',body),
    deletion:body=>authenticated('/management/deletion',body),
    removePhoto:(listingId,photoId)=>authenticated('/management/photos/remove',{listingId,photoId}),
    reorderPhotos:(listingId,photoIds)=>authenticated('/management/photos/reorder',{listingId,photoIds}),
    logout:()=>authenticated('/management/logout',{}),
  };
}

function bounded(value,max,{empty=false}={}){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw new Error();return value;}
function publicPhoto(photo){
  if(!photo||typeof photo!=='object'||Array.isArray(photo)||!UUID.test(photo.id??''))throw new Error();
  const name=bounded(photo.name,40),url=bounded(photo.url,2048);let parsed;try{parsed=new URL(url);}catch{throw new Error();}
  const path=/^\/([A-Za-z0-9_-]{20,64})\/([^/]+)\/([A-Za-z0-9_-]{1,99})$/.exec(parsed.pathname);
  if(parsed.origin!=='https://imagedelivery.net'||parsed.username||parsed.password||parsed.hash||!path||!isGearImageProviderId(path[2])||!/^\?exp=\d{1,12}&sig=[a-f0-9]{64}$/.test(parsed.search))throw new Error();
  return {id:photo.id,name,url:parsed.href};
}
function publicListing(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||!UUID.test(row.id??'')||!CATEGORIES.includes(row.category)||!SIZES.includes(row.size)||!CONDITIONS.includes(row.condition)||!LISTING_TYPES.includes(row.type)||!['available','pending'].includes(row.status))throw new Error();
  if(!Array.isArray(row.clubs)||row.clubs.length>CLUBS.length||new Set(row.clubs).size!==row.clubs.length||row.clubs.some(club=>!CLUBS.includes(club))||!Array.isArray(row.photos)||row.photos.length>LIMITS.photos)throw new Error();
  const priceCents=row.type==='trade'?null:row.type==='free'?0:row.priceCents;if((row.type==='sale'&&(!Number.isSafeInteger(priceCents)||priceCents<LIMITS.minPriceCents||priceCents>LIMITS.maxPriceCents))||(row.type!=='sale'&&row.priceCents!==priceCents))throw new Error();
  const trade=bounded(row.trade??'',LIMITS.trade,{empty:true}),otherClub=bounded(row.otherClub??'',LIMITS.otherClub,{empty:true});if((row.type==='trade')!==Boolean(trade.trim())||row.clubs.includes('Other')!==Boolean(otherClub.trim()))throw new Error();
  return {id:row.id,title:bounded(row.title,LIMITS.title),description:bounded(row.description,LIMITS.description),category:row.category,size:row.size,fit:bounded(row.fit,LIMITS.fit),condition:row.condition,city:bounded(row.city,LIMITS.city),type:row.type,priceCents,trade,clubs:[...row.clubs],otherClub,sellerName:bounded(row.sellerName,LIMITS.name),status:row.status,photos:row.photos.map(publicPhoto)};
}

export function previewListing(row){return {...row,type:row.type==='sale'?'Sale':row.type==='free'?'Free':'Trade',seller:row.sellerName,place:row.city,photos:row.photos||[],age:'',pending:row.status==='pending',status:row.status[0].toUpperCase()+row.status.slice(1),expires:row.expiresAt};}
export function listingInput(d){return {title:d.title,description:d.description,category:d.category,size:d.size,fit:d.fit,condition:d.condition,city:d.city,type:d.type.toLowerCase(),priceCents:d.priceCents,trade:d.trade,clubs:d.clubs,otherClub:d.otherClub,sellerName:d.seller};}
export function draftListingInput(d,adult){return {...listingInput(d),email:d.email,adult:adult===true};}
