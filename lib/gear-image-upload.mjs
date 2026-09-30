import {isGearImageProviderId} from './gear-image-provider-id.mjs';
const DIRECT_UPLOAD_HOST='upload.imagedelivery.net';
export const GEAR_PHOTO_MAX_INPUT_BYTES=5*1024*1024;
export const GEAR_PHOTO_MAX_OUTPUT_BYTES=10_000_000;
export const GEAR_PHOTO_MAX_PIXELS=25_000_000;
export const GEAR_PHOTO_MAX_SIDE=12_000;
export const GEAR_PHOTO_OUTPUT_SIDE=1600;
export const GEAR_PHOTO_DIRECT_UPLOAD_TTL_SECONDS=600;

export class GearImageUploadError extends Error{
  constructor(code,cleanupProviderIds=[]){
    super('Unable to process this photo.');
    this.code=code;
    this.cleanupProviderIds=cleanupProviderIds;
  }
}

function safeCleanupProviderId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
function readU24LE(bytes,offset){return bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16;}
function readFourCC(bytes,offset){return String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);}

export function inspectSanitizedWebP(value){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
  if(bytes.length<20||readFourCC(bytes,0)!=='RIFF'||readFourCC(bytes,8)!=='WEBP')return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(4,true)!==bytes.length-8)return null;
  let offset=12,width=0,height=0,canvasWidth=0,canvasHeight=0,imageChunks=0,extendedChunks=0,alphaChunks=0,flags=0,lastType='';
  while(offset<bytes.length){
    if(imageChunks)return null;
    if(offset+8>bytes.length)return null;
    const type=readFourCC(bytes,offset),length=view.getUint32(offset+4,true),start=offset+8,end=start+length;
    if(end>bytes.length)return null;
    if(type==='VP8X'){
      if(offset!==12||length!==10||(bytes[start]&0xef)!==0||++extendedChunks!==1)return null;
      flags=bytes[start];
      canvasWidth=readU24LE(bytes,start+4)+1;canvasHeight=readU24LE(bytes,start+7)+1;
    }else if(type==='VP8 '){
      if(length<10||bytes[start+3]!==0x9d||bytes[start+4]!==0x01||bytes[start+5]!==0x2a
        ||alphaChunks!==((flags&0x10)?1:0))return null;
      width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;imageChunks++;
    }else if(type==='VP8L'){
      if(length<5||bytes[start]!==0x2f||alphaChunks)return null;
      const bits=view.getUint32(start+1,true);
      width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;imageChunks++;
    }else if(type==='ALPH'){
      if(!(flags&0x10)||lastType!=='VP8X'||++alphaChunks!==1)return null;
    }else return null;
    if((length&1)&&(end>=bytes.length||bytes[end]!==0))return null;
    lastType=type;offset=end+(length&1);
  }
  if(offset!==bytes.length||imageChunks!==1||!width||!height||width>GEAR_PHOTO_OUTPUT_SIDE||height>GEAR_PHOTO_OUTPUT_SIDE)return null;
  if(extendedChunks&&(canvasWidth!==width||canvasHeight!==height))return null;
  return {width,height};
}

function bytesStream(bytes){return new Blob([bytes]).stream();}

async function readBoundedStream(stream,maximum){
  if(!stream?.getReader)throw new TypeError('Missing image stream.');
  const reader=stream.getReader(),chunks=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw new TypeError('Invalid image stream.');
      total+=value.byteLength;if(total>maximum)throw new RangeError('Image is too large.');
      chunks.push(value);
    }
  }catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

function validInfo(info){
  return info&&Number.isSafeInteger(info.width)&&Number.isSafeInteger(info.height)
    &&info.width>0&&info.height>0&&info.width<=GEAR_PHOTO_MAX_SIDE&&info.height<=GEAR_PHOTO_MAX_SIDE
    &&info.width*info.height<=GEAR_PHOTO_MAX_PIXELS;
}

function validOutputDimensions(output,input){
  const scale=Math.min(1,GEAR_PHOTO_OUTPUT_SIDE/Math.max(input.width,input.height));
  const width=Math.max(1,Math.round(input.width*scale)),height=Math.max(1,Math.round(input.height*scale));
  const close=(actual,expected)=>Math.abs(actual-expected)<=1;
  return close(output.width,width)&&close(output.height,height)||close(output.width,height)&&close(output.height,width);
}

async function deleteHostedImage(images,providerId){
  try{await images.hosted.image(providerId).delete();return [];}
  catch{return [providerId];}
}

async function cleanupError(images,code,providerIds){
  const cleanupProviderIds=[];
  for(const providerId of new Set(providerIds))cleanupProviderIds.push(...await deleteHostedImage(images,providerId));
  return new GearImageUploadError(code,cleanupProviderIds);
}

export async function createPrivateGearPhotoUpload(images){
  if(!images?.hosted?.createDirectUpload)throw new GearImageUploadError('config');
  let upload;
  try{
    upload=await images.hosted.createDirectUpload({
      metadata:{purpose:'gear-photo-quarantine'},
      requireSignedURLs:true,
      expiresIn:GEAR_PHOTO_DIRECT_UPLOAD_TTL_SECONDS,
    });
  }catch{throw new GearImageUploadError('upload');}
  let url;
  try{url=new URL(upload?.uploadURL);}catch{
    throw safeCleanupProviderId(upload?.id)&&images.hosted.image
      ?await cleanupError(images,'upload',[upload.id])
      :new GearImageUploadError('upload',safeCleanupProviderId(upload?.id)?[upload.id]:[]);
  }
  if(!isGearImageProviderId(upload?.id)||url.protocol!=='https:'||url.hostname!==DIRECT_UPLOAD_HOST){
    throw safeCleanupProviderId(upload?.id)&&images.hosted.image
      ?await cleanupError(images,'upload',[upload.id])
      :new GearImageUploadError('upload',safeCleanupProviderId(upload?.id)?[upload.id]:[]);
  }
  return {quarantineProviderId:upload.id,uploadURL:url.href};
}

export async function sanitizeQuarantinedHostedImage(images,quarantineProviderId){
  if(!images?.info||!images?.input||!images?.hosted?.image||!images?.hosted?.upload)throw new GearImageUploadError('config');
  if(!isGearImageProviderId(quarantineProviderId))throw new GearImageUploadError('input');
  const quarantine=images.hosted.image(quarantineProviderId);
  let details;
  try{details=await quarantine.details();}
  catch{throw new GearImageUploadError('unavailable');}
  if(!details)throw new GearImageUploadError('input');
  if(details.draft===true)throw new GearImageUploadError('pending');
  if(details.id!==quarantineProviderId||details.requireSignedURLs!==true||details.meta?.purpose!=='gear-photo-quarantine'){
    throw new GearImageUploadError('input');
  }
  let source;
  try{source=await readBoundedStream(await quarantine.bytes(),GEAR_PHOTO_MAX_INPUT_BYTES);}
  catch{throw await cleanupError(images,'input',[quarantineProviderId]);}
  if(source.byteLength<1)throw await cleanupError(images,'input',[quarantineProviderId]);
  let info;
  try{info=await images.info(bytesStream(source));}catch{throw await cleanupError(images,'decode',[quarantineProviderId]);}
  if(!validInfo(info))throw await cleanupError(images,'input',[quarantineProviderId]);
  let response;
  try{
    response=(await images.input(bytesStream(source))
      .transform({width:GEAR_PHOTO_OUTPUT_SIDE,height:GEAR_PHOTO_OUTPUT_SIDE,fit:'scale-down'})
      .output({format:'image/webp',quality:85,anim:false})).response();
  }catch{throw await cleanupError(images,'encode',[quarantineProviderId]);}
  if(!response?.ok||response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='image/webp'){
    throw await cleanupError(images,'encode',[quarantineProviderId]);
  }
  const lengthHeader=response.headers.get('content-length');
  if(lengthHeader!==null){
    const declaredLength=Number(lengthHeader);
    if(!Number.isSafeInteger(declaredLength)||declaredLength<1||declaredLength>GEAR_PHOTO_MAX_OUTPUT_BYTES){
      throw await cleanupError(images,'encode',[quarantineProviderId]);
    }
  }
  let output;
  try{output=await readBoundedStream(response.body,GEAR_PHOTO_MAX_OUTPUT_BYTES);}
  catch{throw await cleanupError(images,'encode',[quarantineProviderId]);}
  const outputInfo=inspectSanitizedWebP(output);
  if(output.byteLength<1||!outputInfo||!validOutputDimensions(outputInfo,info)){
    throw await cleanupError(images,'encode',[quarantineProviderId]);
  }
  let image;
  try{image=await images.hosted.upload(output.buffer,{filename:'gear-photo.webp',requireSignedURLs:true,metadata:{purpose:'gear-photo',source:quarantineProviderId}});}
  catch{throw await cleanupError(images,'upload',[quarantineProviderId]);}
  if(!isGearImageProviderId(image?.id)||image.requireSignedURLs!==true){
    const cleanup=[];
    if(safeCleanupProviderId(image?.id))cleanup.push(...await deleteHostedImage(images,image.id));
    cleanup.push(...await deleteHostedImage(images,quarantineProviderId));
    throw new GearImageUploadError('upload',cleanup);
  }
  const cleanupProviderIds=await deleteHostedImage(images,quarantineProviderId);
  return {providerId:image.id,cleanupProviderIds};
}
