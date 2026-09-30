import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEAR_PHOTO_DIRECT_UPLOAD_TTL_SECONDS,GEAR_PHOTO_MAX_INPUT_BYTES,GEAR_PHOTO_MAX_OUTPUT_BYTES,
  GearImageUploadError,createPrivateGearPhotoUpload,inspectSanitizedWebP,sanitizeQuarantinedHostedImage,
} from '../lib/gear-image-upload.mjs';

const quarantineId='00000000-0000-4000-8000-000000000001';
const providerId='00000000-0000-4000-8000-000000000002';

function chunk(type,payload){
  const data=Uint8Array.from(payload),result=new Uint8Array(8+data.length+(data.length&1));
  result.set(Buffer.from(type),0);new DataView(result.buffer).setUint32(4,data.length,true);result.set(data,8);return result;
}

function container(chunks){
  const size=4+chunks.reduce((sum,value)=>sum+value.length,0),result=new Uint8Array(8+size);
  result.set(Buffer.from('RIFF'),0);new DataView(result.buffer).setUint32(4,size,true);result.set(Buffer.from('WEBP'),8);
  let offset=12;for(const value of chunks){result.set(value,offset);offset+=value.length;}return result;
}

function vp8(width=800,height=600,payloadBytes=10){
  const payload=new Uint8Array(payloadBytes);payload.set([0,0,0,0x9d,0x01,0x2a],0);
  const view=new DataView(payload.buffer);view.setUint16(6,width,true);view.setUint16(8,height,true);return chunk('VP8 ',payload);
}

function vp8x(width,height,flags=0){
  const payload=new Uint8Array(10);payload[0]=flags;
  for(const [offset,value] of [[4,width-1],[7,height-1]]){payload[offset]=value&255;payload[offset+1]=value>>>8&255;payload[offset+2]=value>>>16&255;}
  return chunk('VP8X',payload);
}

function vp8l(width,height){
  const payload=new Uint8Array(5),bits=(width-1)|((height-1)<<14);payload[0]=0x2f;new DataView(payload.buffer).setUint32(1,bits,true);
  return chunk('VP8L',payload);
}

function webp(width=800,height=600,extra=[]){
  return container([vp8(width,height),...extra]);
}

function sizedWebp(totalBytes,width=800,height=600){
  const payloadBytes=totalBytes-20;if(payloadBytes<10||payloadBytes&1)throw new Error('Invalid test size.');
  return container([vp8(width,height,payloadBytes)]);
}

async function streamBytes(stream){return new Uint8Array(await new Response(stream).arrayBuffer());}

function bindings(overrides={}){
  const calls=[],source=Uint8Array.from([0xff,0xd8,0xff,0xe0,1,2,3]),output=webp();
  const records=new Map([[quarantineId,{bytes:source,details:{id:quarantineId,draft:false,requireSignedURLs:true,meta:{purpose:'gear-photo-quarantine'}}}]]);
  const hosted={
    async createDirectUpload(options){calls.push(['createDirectUpload',options]);return {id:quarantineId,uploadURL:'https://upload.imagedelivery.net/account/token'};},
    image(id){return {
      async details(){calls.push(['details',id]);return records.get(id)?.details;},
      async bytes(){calls.push(['bytes',id]);const bytes=records.get(id)?.bytes;return bytes?new Blob([bytes]).stream():null;},
      async delete(){calls.push(['delete',id]);return records.delete(id);},
    };},
    async upload(value,options){calls.push(['upload',new Uint8Array(value),options]);records.set(providerId,{bytes:new Uint8Array(value),details:{id:providerId,requireSignedURLs:true}});return {id:providerId,requireSignedURLs:true};},
  };
  const chain={transform(value){calls.push(['transform',value]);return this;},async output(value){calls.push(['output',value]);return {response:()=>new Response(output,{headers:{'content-type':'image/webp'}})};}};
  const images={
    async info(value){calls.push(['info',await streamBytes(value)]);return {width:800,height:600};},
    input(value){calls.push(['input',value]);return chain;},
    hosted,
    ...overrides,
  };
  return {images,calls,records,source,output};
}

test('creates a ten-minute private quarantine upload without personal metadata',async()=>{
  const {images,calls}=bindings();
  assert.deepEqual(await createPrivateGearPhotoUpload(images),{quarantineProviderId:quarantineId,uploadURL:'https://upload.imagedelivery.net/account/token'});
  assert.deepEqual(calls,[['createDirectUpload',{metadata:{purpose:'gear-photo-quarantine'},requireSignedURLs:true,expiresIn:GEAR_PHOTO_DIRECT_UPLOAD_TTL_SECONDS}]]);
});

test('quarantine upload response is narrowly validated and preserves a cleanup reference',async()=>{
  for(const result of [
    {id:'bad',uploadURL:'https://upload.imagedelivery.net/a/b'},
    {id:quarantineId,uploadURL:'http://upload.imagedelivery.net/a/b'},
    {id:quarantineId,uploadURL:'https://example.com/a/b'},
  ]){
    const {images}=bindings({hosted:{createDirectUpload:async()=>result}});
    await assert.rejects(createPrivateGearPhotoUpload(images),error=>error instanceof GearImageUploadError&&error.code==='upload'&&
      assert.deepEqual(error.cleanupProviderIds,[result.id])===undefined);
  }
  const cleaned=bindings();cleaned.images.hosted.createDirectUpload=async()=>({id:quarantineId,uploadURL:'https://example.com/a/b'});
  await assert.rejects(createPrivateGearPhotoUpload(cleaned.images),error=>error.cleanupProviderIds.length===0);
  assert.equal(cleaned.records.has(quarantineId),false);
});

test('downloads private quarantine, uses streams, uploads verified output and deletes original',async()=>{
  const {images,calls,records,source,output}=bindings();
  assert.deepEqual(await sanitizeQuarantinedHostedImage(images,quarantineId),{providerId,cleanupProviderIds:[]});
  assert.deepEqual(calls.map(call=>call[0]),['details','bytes','info','input','transform','output','upload','delete']);
  assert.deepEqual(calls[2][1],source);
  assert.deepEqual(await streamBytes(calls[3][1]),source);
  assert.deepEqual(calls[4][1],{width:1600,height:1600,fit:'scale-down'});
  assert.deepEqual(calls[5][1],{format:'image/webp',quality:85,anim:false});
  assert.deepEqual(calls[6][1],output);assert.notDeepEqual(calls[6][1],source);
  assert.deepEqual(calls[6][2],{filename:'gear-photo.webp',requireSignedURLs:true,metadata:{purpose:'gear-photo',source:quarantineId}});
  assert.equal(records.has(quarantineId),false);assert.equal(records.has(providerId),true);
});

test('WebP verifier accepts bounded lossy, alpha, lossless and extended lossless output',()=>{
  const values=[
    [webp(),{width:800,height:600}],
    [container([vp8x(800,600,0x10),chunk('ALPH',[0]),vp8(800,600)]),{width:800,height:600}],
    [container([vp8l(1600,1)]),{width:1600,height:1}],
    [container([vp8x(800,600),vp8l(800,600)]),{width:800,height:600}],
    [container([vp8x(800,600,0x10),vp8l(800,600)]),{width:800,height:600}],
  ];
  for(const [value,expected] of values)assert.deepEqual(inspectSanitizedWebP(value),expected);
});

test('WebP verifier rejects unsafe flags, chunks, ordering, duplication, framing and dimensions',()=>{
  const alpha=container([vp8x(800,600,0x10),chunk('ALPH',[0]),vp8(800,600)]),badPad=alpha.slice();badPad[39]=1;
  const shortRiff=webp(),longRiff=webp();new DataView(shortRiff.buffer).setUint32(4,shortRiff.length-9,true);new DataView(longRiff.buffer).setUint32(4,longRiff.length-7,true);
  const rejected=[
    ...['EXIF','XMP ','ICCP','ANIM','ANMF','JUNK'].map(type=>container([chunk(type,[1]),vp8()])),
    ...[0x02,0x04,0x08,0x20,0x80].map(flags=>container([vp8x(800,600,flags),vp8()])),
    container([vp8x(800,600),vp8x(800,600),vp8()]),
    container([vp8x(800,600,0x10),chunk('ALPH',[0]),chunk('ALPH',[0]),vp8()]),
    container([vp8(),vp8l(800,600)]),container([vp8x(801,600),vp8(800,600)]),
    container([chunk('ALPH',[0]),vp8()]),container([vp8x(800,600),chunk('ALPH',[0]),vp8()]),
    container([vp8x(800,600,0x10),vp8()]),container([vp8x(800,600,0x10),chunk('ALPH',[0]),vp8l(800,600)]),
    badPad,shortRiff,longRiff,webp(1601,1),webp(1,1601),Uint8Array.from([1,2,3]),webp().slice(0,-1),
  ];
  for(const value of rejected)assert.equal(inspectSanitizedWebP(value),null);
});

test('invalid transform responses never upload and immediately clean quarantine',async()=>{
  const valid=webp(),responses=[
    new Response(valid,{status:500,headers:{'content-type':'image/webp'}}),
    new Response(valid,{headers:{'content-type':'image/png'}}),new Response(new Uint8Array(),{headers:{'content-type':'image/webp'}}),
    new Response(chunk('EXIF',[1]),{headers:{'content-type':'image/webp'}}),
    new Response(valid,{headers:{'content-type':'image/webp','content-length':String(GEAR_PHOTO_MAX_OUTPUT_BYTES+1)}}),
    {ok:true,headers:new Headers({'content-type':'image/webp'}),arrayBuffer:async()=>new ArrayBuffer(GEAR_PHOTO_MAX_OUTPUT_BYTES+1)},
    new Response(sizedWebp(GEAR_PHOTO_MAX_OUTPUT_BYTES+2),{headers:{'content-type':'image/webp'}}),
  ];
  for(const response of responses){
    const {images,calls,records}=bindings({input:()=>({transform(){return this;},async output(){return {response:()=>response};}})});
    await assert.rejects(sanitizeQuarantinedHostedImage(images,quarantineId),error=>error.code==='encode'&&error.cleanupProviderIds.length===0);
    assert.equal(calls.some(call=>call[0]==='upload'),false);
    assert.equal(records.has(quarantineId),false);
  }
});

test('actual hosted byte length and decoded dimensions are bounded',async()=>{
  const tooLarge=new Uint8Array(GEAR_PHOTO_MAX_INPUT_BYTES+1);
  for(const overrides of [
    {hosted:{image:()=>({details:async()=>({id:quarantineId,draft:false,requireSignedURLs:true,meta:{purpose:'gear-photo-quarantine'}}),bytes:async()=>new Blob([tooLarge]).stream(),delete:async()=>true}),upload:async()=>{throw new Error('unused');}}},
    {info:async()=>({width:12001,height:1})},{info:async()=>({width:1,height:12001})},
    {info:async()=>({width:6250,height:4001})},{info:async()=>({width:'1200',height:800})},
    {info:async()=>({format:'image/svg+xml'})},
  ]){
    const base=bindings(),images={...base.images,...overrides,hosted:overrides.hosted||base.images.hosted};
    await assert.rejects(sanitizeQuarantinedHostedImage(images,quarantineId),error=>error.code==='input'&&error.cleanupProviderIds.length===0);
  }
});

test('production bounds accept current 24 MP phone dimensions and reject above 25 million pixels',async()=>{
  const phone=bindings({info:async()=>({width:5712,height:4284})});
  phone.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(webp(1600,1200),{headers:{'content-type':'image/webp'}})};}});
  assert.deepEqual(await sanitizeQuarantinedHostedImage(phone.images,quarantineId),{providerId,cleanupProviderIds:[]});

  const over=bindings({info:async()=>({width:5000,height:5001})});
  await assert.rejects(sanitizeQuarantinedHostedImage(over.images,quarantineId),error=>error.code==='input'&&error.cleanupProviderIds.length===0);
  assert.equal(over.records.has(quarantineId),false);
});

test('input and output size limits are inclusive and output dimensions must match scale-down',async()=>{
  const exactInput=bindings();exactInput.records.get(quarantineId).bytes=new Uint8Array(GEAR_PHOTO_MAX_INPUT_BYTES);
  assert.deepEqual(await sanitizeQuarantinedHostedImage(exactInput.images,quarantineId),{providerId,cleanupProviderIds:[]});

  const exactOutput=bindings(),output=sizedWebp(GEAR_PHOTO_MAX_OUTPUT_BYTES);
  exactOutput.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(output,{headers:{'content-type':'image/webp'}})};}});
  assert.deepEqual(await sanitizeQuarantinedHostedImage(exactOutput.images,quarantineId),{providerId,cleanupProviderIds:[]});

  for(const value of [webp(798,600),webp(800,598)]){
    const mismatch=bindings();mismatch.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(value,{headers:{'content-type':'image/webp'}})};}});
    await assert.rejects(sanitizeQuarantinedHostedImage(mismatch.images,quarantineId),error=>error.code==='encode');
    assert.equal(mismatch.records.has(quarantineId),false);
  }

  const scaled=bindings({info:async()=>({width:4032,height:3024})});
  scaled.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(webp(1600,1200),{headers:{'content-type':'image/webp'}})};}});
  assert.deepEqual(await sanitizeQuarantinedHostedImage(scaled.images,quarantineId),{providerId,cleanupProviderIds:[]});

  const rotated=bindings({info:async()=>({width:3024,height:4032})});
  rotated.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(webp(1600,1200),{headers:{'content-type':'image/webp'}})};}});
  assert.deepEqual(await sanitizeQuarantinedHostedImage(rotated.images,quarantineId),{providerId,cleanupProviderIds:[]});

  for(const [width,height,outWidth,outHeight] of [[4032,3024,1600,1203],[12000,2000,1600,267],[12000,1,1600,1]]){
    const fixture=bindings({info:async()=>({width,height})});
    fixture.images.input=()=>({transform(){return this;},async output(){return {response:()=>new Response(webp(outWidth,outHeight),{headers:{'content-type':'image/webp'}})};}});
    if(outHeight===1203)await assert.rejects(sanitizeQuarantinedHostedImage(fixture.images,quarantineId),error=>error.code==='encode');
    else assert.deepEqual(await sanitizeQuarantinedHostedImage(fixture.images,quarantineId),{providerId,cleanupProviderIds:[]});
  }
});

test('quarantine identity gates fail without deleting an unconfirmed image',async()=>{
  const cases=[
    [details=>{details.draft=true;},'pending'],
    [details=>{details.requireSignedURLs=false;},'input'],
    [details=>{details.id=providerId;},'input'],
    [details=>{details.meta={purpose:'other'};},'input'],
  ];
  for(const [mutate,code] of cases){
    const fixture=bindings();mutate(fixture.records.get(quarantineId).details);
    await assert.rejects(sanitizeQuarantinedHostedImage(fixture.images,quarantineId),error=>error.code===code&&error.cleanupProviderIds.length===0);
    assert.equal(fixture.records.has(quarantineId),true);assert.equal(fixture.calls.some(call=>call[0]==='delete'),false);
  }

  const unavailable=bindings(),unavailableImage=unavailable.images.hosted.image.bind(unavailable.images.hosted);
  unavailable.images.hosted.image=id=>{const handle=unavailableImage(id);handle.details=async()=>{throw new Error('private');};return handle;};
  await assert.rejects(sanitizeQuarantinedHostedImage(unavailable.images,quarantineId),error=>error.code==='unavailable');
  assert.equal(unavailable.records.has(quarantineId),true);assert.equal(unavailable.calls.some(call=>call[0]==='delete'),false);
});

test('invalid or missing hosted byte streams clean a confirmed quarantine',async()=>{
  for(const stream of [null,new ReadableStream({start(controller){controller.enqueue('not bytes');controller.close();}})]){
    const fixture=bindings(),original=fixture.images.hosted.image.bind(fixture.images.hosted);
    fixture.images.hosted.image=id=>{
      const handle=original(id);if(id===quarantineId)handle.bytes=async()=>stream;return handle;
    };
    await assert.rejects(sanitizeQuarantinedHostedImage(fixture.images,quarantineId),error=>error.code==='input'&&error.cleanupProviderIds.length===0);
    assert.equal(fixture.records.has(quarantineId),false);
  }
});

test('invalid uploaded metadata is immediately cleaned up and cleanup failures are exposed',async()=>{
  const base=bindings();
  base.images.hosted.upload=async value=>{base.records.set(providerId,{bytes:new Uint8Array(value)});return {id:providerId,requireSignedURLs:false};};
  await assert.rejects(sanitizeQuarantinedHostedImage(base.images,quarantineId),error=>error.code==='upload'&&error.cleanupProviderIds.length===0);
  assert.equal(base.records.has(providerId),false);assert.equal(base.records.has(quarantineId),false);

  const failed=bindings();
  failed.images.hosted.upload=async()=>({id:providerId,requireSignedURLs:false});
  failed.images.hosted.image=id=>({
    details:async()=>failed.records.get(id)?.details,bytes:async()=>{const bytes=failed.records.get(id)?.bytes;return bytes?new Blob([bytes]).stream():null;},
    delete:async()=>{throw new Error('private provider detail');},
  });
  await assert.rejects(sanitizeQuarantinedHostedImage(failed.images,quarantineId),error=>{
    assert.equal(error.code,'upload');assert.deepEqual(error.cleanupProviderIds,[providerId,quarantineId]);return true;
  });

  const partial=bindings(),original=partial.images.hosted.image.bind(partial.images.hosted);
  partial.images.hosted.upload=async value=>{partial.records.set(providerId,{bytes:new Uint8Array(value)});return {id:providerId,requireSignedURLs:false};};
  partial.images.hosted.image=id=>{const handle=original(id);if(id===providerId)handle.delete=async()=>{throw new Error('private');};return handle;};
  await assert.rejects(sanitizeQuarantinedHostedImage(partial.images,quarantineId),error=>{
    assert.deepEqual(error.cleanupProviderIds,[providerId]);return true;
  });
  assert.equal(partial.records.has(quarantineId),false);assert.equal(partial.records.has(providerId),true);

  const future=bindings();future.images.hosted.upload=async value=>{future.records.set('ABC_def-1',{bytes:new Uint8Array(value)});return {id:'ABC_def-1',requireSignedURLs:true};};
  await assert.rejects(sanitizeQuarantinedHostedImage(future.images,quarantineId),error=>error.code==='upload'&&error.cleanupProviderIds.length===0);
  assert.equal(future.records.has('ABC_def-1'),false);assert.equal(future.records.has(quarantineId),false);

  const missing=bindings(),missingOriginal=missing.images.hosted.image.bind(missing.images.hosted);
  missing.images.hosted.image=id=>{const handle=missingOriginal(id);handle.delete=async()=>false;return handle;};
  assert.deepEqual(await sanitizeQuarantinedHostedImage(missing.images,quarantineId),{providerId,cleanupProviderIds:[]});
});

test('configuration, provider reads, decode, transform and upload errors stay generic',async()=>{
  await assert.rejects(createPrivateGearPhotoUpload({}),error=>error.code==='config');
  const decode=bindings({info:async()=>{throw new Error('private decode');}}),encode=bindings({input:()=>({transform(){return this;},async output(){throw new Error('private encode');}})});
  const cases=[[{},'config',[],null],[decode.images,'decode',[],decode],[encode.images,'encode',[],encode]];
  for(const [images,code,cleanup,fixture] of cases)await assert.rejects(sanitizeQuarantinedHostedImage(images,quarantineId),error=>{
    assert.equal(error instanceof GearImageUploadError,true);assert.equal(error.code,code);
    assert.equal(error.message.includes('private'),false);assert.deepEqual(error.cleanupProviderIds,cleanup);return true;
  });
  assert.equal(decode.records.has(quarantineId),false);assert.equal(encode.records.has(quarantineId),false);

  const missingMarker=bindings();missingMarker.records.get(quarantineId).details.meta={purpose:'other'};
  await assert.rejects(sanitizeQuarantinedHostedImage(missingMarker.images,quarantineId),error=>error.code==='input'&&error.cleanupProviderIds.length===0);
  assert.equal(missingMarker.records.has(quarantineId),true);

  const failedUpload=bindings();failedUpload.images.hosted.upload=async()=>{throw new Error('private upload');};
  await assert.rejects(sanitizeQuarantinedHostedImage(failedUpload.images,quarantineId),error=>error.code==='upload'&&error.cleanupProviderIds.length===0);
  assert.equal(failedUpload.records.has(quarantineId),false);
});
