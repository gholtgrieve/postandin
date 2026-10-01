import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listingInput,previewListing,productionAPI,takeManagementToken} from '../gear/production-api.mjs';

const TOKEN='a'.repeat(64),CSRF='b'.repeat(64),ID='00000000-0000-4000-8000-000000000001';
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('management fragment is removed immediately and only a strict token is returned',()=>{
  const calls=[],history={state:{kept:true},replaceState(...args){calls.push(args);}};
  assert.equal(takeManagementToken({hash:'#management='+TOKEN,pathname:'/gear/',search:'?from=email'},history),TOKEN);
  assert.deepEqual(calls,[[history.state,'','/gear/?from=email']]);
  assert.equal(takeManagementToken({hash:'#management=BAD',pathname:'/gear/',search:''},history),null);
  assert.deepEqual(calls.at(-1),[history.state,'','/gear/']);
  const count=calls.length;
  assert.equal(takeManagementToken({hash:'#browse',pathname:'/gear/',search:''},history),null);
  assert.equal(calls.length,count);
});

test('production adapter refuses every noncanonical origin',()=>{
  for(const origin of ['http://postandin.com','https://www.postandin.com','https://preview.pages.dev'])assert.throws(()=>productionAPI({origin,fetcher:async()=>json(200,{})}),/approved Gear origin/);
});

test('management writes recover CSRF and use bounded same-origin POST requests',async()=>{
  const calls=[],fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/session'))return json(200,{csrf:CSRF,expiresAt:123});
    return json(200,{ok:true});
  };
  const api=productionAPI({origin:'https://postandin.com',fetcher});
  await api.write({id:ID,action:'close'});
  await api.deletion({id:ID,action:'delete'});
  await api.removePhoto(ID,ID);
  await api.reorderPhotos(ID,[ID]);
  await api.logout();
  assert.equal(calls.length,10);
  for(const call of calls){
    assert.equal(call.options.method,'POST');assert.equal(call.options.credentials,'same-origin');
    assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');assert.equal(call.options.referrerPolicy,'no-referrer');
  }
  for(const call of calls.filter(call=>!call.url.endsWith('/session')))assert.equal(call.options.headers['X-Gear-CSRF'],CSRF);
  assert.deepEqual(calls.filter(call=>!call.url.endsWith('/session')).map(call=>call.url),[
    '/api/gear/management/listing','/api/gear/management/deletion','/api/gear/management/photos/remove','/api/gear/management/photos/reorder','/api/gear/management/logout',
  ]);
});

test('production seller recovery uses the deletion route recovery action',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/api\.deletion\(\{id:b\.dataset\.recover,action:'recover'\}\)/);
});

test('confirmation and recovery keep credentials in POST bodies and expose safe errors',async()=>{
  const calls=[],api=productionAPI({origin:'https://postandin.com',fetcher:async(url,options)=>{calls.push({url,options});return url.endsWith('/recovery')?json(202,{message:'Accepted'}):json(400,{error:'Access unavailable.',fields:{title:'Required'}});}});
  await api.recover('seller@example.test');
  await assert.rejects(api.confirm(TOKEN),error=>error.safe&&error.status===400&&error.message==='Access unavailable.'&&error.fields.title==='Required');
  assert.equal(calls[1].url.includes(TOKEN),false);assert.equal(JSON.stringify(calls[1].options.headers).includes(TOKEN),false);
  assert.deepEqual(JSON.parse(calls[1].options.body),{token:TOKEN,confirm:true});
});

test('photo upload uses credentialless multipart delivery and retries only pending finalization',async()=>{
  const calls=[],waits=[];let finalizes=0;
  const api=productionAPI({origin:'https://postandin.com',wait:async ms=>waits.push(ms),fetcher:async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/session'))return json(200,{csrf:CSRF,expiresAt:123});
    if(String(url).endsWith('/photos/upload'))return json(201,{quarantineProviderId:ID,uploadURL:'https://upload.imagedelivery.net/direct'});
    if(String(url)==='https://upload.imagedelivery.net/direct')return new Response('',{status:200});
    if(String(url).endsWith('/photos/finalize'))return ++finalizes<3?json(409,{error:'Photo upload is still in progress.'}):json(200,{ok:true});
    throw new Error('Unexpected request');
  }});
  const result=await api.uploadPhoto(ID,new File(['photo-bytes'],'gear.jpg',{type:'image/jpeg'}));
  assert.deepEqual(result,{ok:true});assert.deepEqual(waits,[1000,1000]);
  const direct=calls.find(call=>call.url==='https://upload.imagedelivery.net/direct');
  assert.equal(direct.options.credentials,'omit');assert.equal(direct.options.redirect,'error');assert.equal(direct.options.referrerPolicy,'no-referrer');assert.ok(direct.options.body instanceof FormData);assert.equal(Object.hasOwn(direct.options.headers??{},'Content-Type'),false);
  assert.equal(direct.options.body.get('file').name,'gear-photo');
  assert.equal(calls.filter(call=>call.url.endsWith('/photos/finalize')).length,3);
});

test('photo finalize exhaustion is bounded and gives an honest recovery instruction',async()=>{
  let finalizes=0;const api=productionAPI({origin:'https://postandin.com',wait:async()=>{},fetcher:async(url)=>{
    if(String(url).endsWith('/session'))return json(200,{csrf:CSRF});
    if(String(url).endsWith('/photos/upload'))return json(201,{quarantineProviderId:ID,uploadURL:'https://upload.imagedelivery.net/direct'});
    if(String(url)==='https://upload.imagedelivery.net/direct')return new Response('',{status:200});
    if(String(url).endsWith('/photos/finalize')){finalizes++;return json(409,{error:'Photo upload is still in progress.'});}
  }});
  await assert.rejects(api.uploadPhoto(ID,new File(['x'],'gear.jpg',{type:'image/jpeg'})),error=>error.safe&&error.status===409&&/was not attached/.test(error.message));
  assert.equal(finalizes,4);
});

test('photo upload validates local files and provider response before cross-origin delivery',async()=>{
  let calls=0;const api=productionAPI({origin:'https://postandin.com',fetcher:async(url)=>{calls++;if(String(url).endsWith('/session'))return json(200,{csrf:CSRF});return json(201,{quarantineProviderId:ID,uploadURL:'http://upload.imagedelivery.net/direct'});}});
  await assert.rejects(api.uploadPhoto(ID,new File([], 'empty.jpg',{type:'image/jpeg'})),/Choose a JPG/);assert.equal(calls,0);
  await assert.rejects(api.uploadPhoto(ID,new File(['x'],'gear.gif',{type:'image/gif'})),/Choose a JPG/);assert.equal(calls,0);
  await assert.rejects(api.uploadPhoto(ID,new File(['x'],'gear.jpg',{type:'image/jpeg'})),/unreadable response/);assert.equal(calls,2);
});

test('production projections preserve only fields needed by the existing editor',()=>{
  const row=previewListing({id:ID,type:'sale',sellerName:'Alex',city:'Seattle',status:'available',expiresAt:99,photos:[{id:ID,url:'https://example.test/photo'}]});
  assert.equal(row.type,'Sale');assert.equal(row.seller,'Alex');assert.equal(row.status,'Available');assert.equal(row.expires,99);
  const input=listingInput({...row,title:'Bag',description:'Good bag',category:'Bundles',size:'Junior',fit:'Junior',condition:'Used — good',priceCents:1200,trade:null,clubs:[],otherClub:''});
  assert.equal(Object.hasOwn(input,'email'),false);assert.equal(Object.hasOwn(input,'adult'),false);assert.equal(Object.hasOwn(input,'photos'),false);assert.equal(input.sellerName,'Alex');
});
