import test from 'node:test';
import assert from 'node:assert/strict';
import {createGearImagesWorker} from '../gear-images/src/index.js';
import {GearImageUploadError} from '../lib/gear-image-upload.mjs';

const original='00000000-0000-4000-8000-000000000001',sanitized='00000000-0000-4000-8000-000000000002';
const images=()=>({hosted:{createDirectUpload(){},upload(){},image(){return {delete:async()=>true}}},info(){},input(){}});
const request=(path,value={},options={})=>{const method=options.method??'POST';return new Request('https://gear-images.internal'+path,{method,headers:{'Content-Type':'application/json',...options.headers},...(method==='GET'||method==='HEAD'?{}:{body:options.body??JSON.stringify(value)})});};

test('service creates private upload contracts only through bounded internal JSON',async()=>{
  let calls=0;const worker=createGearImagesWorker({create:async binding=>{calls++;assert.ok(binding);return {quarantineProviderId:original,uploadURL:'https://upload.imagedelivery.net/token'}}});
  const response=await worker.fetch(request('/internal/gear/photos/upload'),{IMAGES:images()});
  assert.equal(response.status,201);assert.deepEqual(await response.json(),{quarantineProviderId:original,uploadURL:'https://upload.imagedelivery.net/token'});assert.equal(calls,1);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await worker.fetch(request('/internal/gear/photos/upload',{}, {method:'GET'}),{IMAGES:images()})).status,405);
  assert.equal((await worker.fetch(request('/internal/gear/photos/upload',{extra:true}),{IMAGES:images()})).status,400);
  assert.equal((await worker.fetch(request('/internal/gear/photos/upload',{}, {headers:{'Content-Type':'text/plain'}}),{IMAGES:images()})).status,415);
  assert.equal((await worker.fetch(request('/internal/gear/photos/upload',{}, {body:JSON.stringify({padding:'x'.repeat(600)})}),{IMAGES:images()})).status,413);
});

test('service sanitizes only validated quarantine IDs and preserves server cleanup references',async()=>{
  const worker=createGearImagesWorker({sanitize:async(binding,id)=>{assert.ok(binding);assert.equal(id,original);return {providerId:sanitized,cleanupProviderIds:[original]}}});
  const response=await worker.fetch(request('/internal/gear/photos/sanitize',{quarantineProviderId:original}),{IMAGES:images()});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{providerId:sanitized,cleanupProviderIds:[original]});
  assert.equal((await worker.fetch(request('/internal/gear/photos/sanitize',{quarantineProviderId:'bad'}),{IMAGES:images()})).status,400);
  assert.equal((await worker.fetch(request('/internal/gear/photos/sanitize',{quarantineProviderId:original,extra:true}),{IMAGES:images()})).status,400);
});

test('provider states and failures stay bounded and generic',async()=>{
  for(const [code,status,error] of [['pending',409,'pending'],['unavailable',503,'unavailable'],['input',422,'rejected']]){
    const worker=createGearImagesWorker({sanitize:async()=>{throw new GearImageUploadError(code,[original])}});
    const response=await worker.fetch(request('/internal/gear/photos/sanitize',{quarantineProviderId:original}),{IMAGES:images()});
    assert.equal(response.status,status);const result=await response.json();assert.equal(result.error,error);
    assert.deepEqual(result.cleanupProviderIds,code==='input'?[original]:undefined);
  }
  const worker=createGearImagesWorker({create:async()=>{throw new Error('private provider detail')}});
  const response=await worker.fetch(request('/internal/gear/photos/upload'),{IMAGES:images()});
  assert.equal(response.status,503);assert.equal((await response.text()).includes('private provider detail'),false);
  assert.equal((await worker.fetch(request('/internal/gear/photos/upload'),{})).status,503);
  for(const [code,cleanup] of [['upload',[original]],['config',[]]]){
    const unavailable=createGearImagesWorker({create:async()=>{throw new GearImageUploadError(code,cleanup)}});
    const result=await unavailable.fetch(request('/internal/gear/photos/upload'),{IMAGES:images()});
    assert.equal(result.status,503);assert.deepEqual(await result.json(),{error:'unavailable',...(cleanup.length?{cleanupProviderIds:cleanup}:{})});
  }
  const config=createGearImagesWorker({sanitize:async()=>{throw new GearImageUploadError('config')}});
  assert.equal((await config.fetch(request('/internal/gear/photos/sanitize',{quarantineProviderId:original}),{IMAGES:images()})).status,503);
});

test('service performs idempotent compensation deletes and exposes no provider detail',async()=>{
  const deleted=[];const binding=images();binding.hosted.image=id=>({delete:async()=>{deleted.push(id);return false}});
  const worker=createGearImagesWorker();
  const response=await worker.fetch(request('/internal/gear/photos/delete',{providerId:original}),{IMAGES:binding});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.deepEqual(deleted,[original]);
  assert.equal((await worker.fetch(request('/internal/gear/photos/delete',{providerId:'bad'}),{IMAGES:binding})).status,400);
  assert.equal((await worker.fetch(request('/unknown'),{IMAGES:binding})).status,404);
  binding.hosted.image=()=>({delete:async()=>{throw new Error('private delete detail')}});
  const failed=await worker.fetch(request('/internal/gear/photos/delete',{providerId:original}),{IMAGES:binding});
  assert.equal(failed.status,503);assert.equal((await failed.text()).includes('private delete detail'),false);
  binding.hosted.image=()=>({delete:()=>new Promise(()=>{})});
  const timed=createGearImagesWorker({deleteTimeoutMs:5});
  assert.equal((await timed.fetch(request('/internal/gear/photos/delete',{providerId:original}),{IMAGES:binding})).status,503);
});
