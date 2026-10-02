import {isGearImageProviderId} from './gear-image-provider-id.mjs';

export const GEAR_PUBLIC_PHOTO_URL_TTL_SECONDS=600;
const ACCOUNT_HASH=/^[A-Za-z0-9_-]{20,64}$/;
const VARIANT=/^[A-Za-z0-9_-]{1,99}$/;
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');

export function gearPhotoDeliveryConfig(env){
  const accountHash=env?.GEAR_IMAGES_ACCOUNT_HASH,variant=env?.GEAR_IMAGES_PUBLIC_VARIANT,signingKey=env?.GEAR_IMAGES_SIGNING_KEY;
  return ACCOUNT_HASH.test(accountHash??'')&&VARIANT.test(variant??'')&&typeof signingKey==='string'&&signingKey===signingKey.trim()
    &&!/[\s]/.test(signingKey)&&signingKey.length>=16&&signingKey.length<=4096
    ?{accountHash,variant,signingKey}:null;
}

export async function createGearPhotoSigner(config,now=Date.now()){
  if(!config||!ACCOUNT_HASH.test(config.accountHash??'')||!VARIANT.test(config.variant??'')
    ||typeof config.signingKey!=='string'||config.signingKey!==config.signingKey.trim()||/[\s]/.test(config.signingKey)
    ||config.signingKey.length<16||config.signingKey.length>4096
    ||!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid Gear photo projection.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.signingKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expiry=Math.floor(now/1000)+GEAR_PUBLIC_PHOTO_URL_TTL_SECONDS,encoder=new TextEncoder();
  return async function signGearPhotos(photoRefs){
    if(!Array.isArray(photoRefs)||photoRefs.length>6||photoRefs.some(ref=>!ref||typeof ref!=='object'||Object.keys(ref).length!==2
      ||!isGearImageProviderId(ref.id)||!isGearImageProviderId(ref.providerId)))throw new TypeError('Invalid Gear photo reference.');
    return Promise.all(photoRefs.map(async(ref,index)=>{
      const path=`/${config.accountHash}/${ref.providerId}/${config.variant}`,search=`exp=${expiry}`;
      const mac=await crypto.subtle.sign('HMAC',key,encoder.encode(`${path}?${search}`));
      return {id:ref.id,name:`Photo ${index+1}`,url:`https://imagedelivery.net${path}?${search}&sig=${hex(new Uint8Array(mac))}`};
    }));
  };
}
