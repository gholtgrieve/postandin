import test from 'node:test';
import assert from 'node:assert/strict';
import {productionAPI,previewListing} from '../gear/production-api.mjs';
import {createGearListingsHandler} from '../functions/api/gear/listings.js';

const ORIGIN='https://postandin.com',ID='00000000-0000-4000-8000-000000000010';
const PHOTO_ID='00000000-0000-4000-8000-000000000011';
const PHOTO_URL='https://imagedelivery.net/AbCdEfGhIjKlMnOpQrStUv/00000000-0000-4000-8000-000000000012/gear-public?exp=2000000000&sig='+('c'.repeat(64));
const DELIVERY={GEAR_IMAGES_ACCOUNT_HASH:'AbCdEfGhIjKlMnOpQrStUv',GEAR_IMAGES_PUBLIC_VARIANT:'gear-public',GEAR_IMAGES_SIGNING_KEY:'test-signing-key-not-secret'};
const listing={id:ID,title:'Public bag',description:'Visible scuffs.',category:'Bags & accessories',size:'Junior',fit:'Junior bag',condition:'Used — good',city:'Seattle',type:'sale',priceCents:4000,trade:null,clubs:['Seattle Junior'],otherClub:null,sellerName:'Alex',status:'available',photos:[{id:PHOTO_ID,name:'Photo 1',url:PHOTO_URL}],privateValue:'must not survive'};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('production browse uses a bounded same-origin GET and projects only validated public fields',async()=>{
  const calls=[],api=productionAPI({origin:ORIGIN,fetcher:async(url,options)=>{calls.push({url,options});return json(200,{listings:[listing]});}});
  const result=await api.listings();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/gear/listings');assert.deepEqual(calls[0].options,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
  assert.deepEqual(result.listings[0],{id:ID,title:'Public bag',description:'Visible scuffs.',category:'Bags & accessories',size:'Junior',fit:'Junior bag',condition:'Used — good',city:'Seattle',type:'sale',priceCents:4000,trade:'',clubs:['Seattle Junior'],otherClub:'',sellerName:'Alex',status:'available',photos:[{id:PHOTO_ID,name:'Photo 1',url:PHOTO_URL}]});
  assert.equal(Object.hasOwn(result.listings[0],'privateValue'),false);const preview=previewListing(result.listings[0]);assert.equal(preview.type,'Sale');assert.equal(preview.seller,'Alex');assert.equal(preview.place,'Seattle');assert.equal(preview.photos[0].url,PHOTO_URL);
});

test('production browse rejects malformed rows, unsafe photos and oversized result sets',async()=>{
  const photo=url=>({...listing,photos:[{id:PHOTO_ID,name:'Photo 1',url}]});
  const invalid=[
    {...listing,id:'bad'},
    {...listing,status:'removed'},
    {...listing,clubs:['Seattle Junior','Seattle Junior']},
    {...listing,type:'free',priceCents:4000},
    photo('https://example.test/tracker'),photo(PHOTO_URL.replace('https:','http:')),photo(PHOTO_URL.replace('imagedelivery.net','imagedelivery.net.evil.test')),
    photo(PHOTO_URL.replace('https://','https://user:pass@')),photo(PHOTO_URL.replace('imagedelivery.net/','imagedelivery.net:8443/')),photo('https://imagedelivery.net/anything?exp=1&sig='+('c'.repeat(64))),photo(PHOTO_URL.replace('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000ABC')),photo(PHOTO_URL+'&extra=1'),photo(PHOTO_URL+'#fragment'),
  ];
  for(const row of invalid){const api=productionAPI({origin:ORIGIN,fetcher:async()=>json(200,{listings:[row]})});await assert.rejects(api.listings(),error=>error.safe&&error.status===0&&/unreadable response/.test(error.message));}
  const tooMany=productionAPI({origin:ORIGIN,fetcher:async()=>json(200,{listings:Array.from({length:101},()=>listing)})});await assert.rejects(tooMany.listings(),/unreadable response/);
  const wrongShape=productionAPI({origin:ORIGIN,fetcher:async()=>json(200,{listings:{}})});await assert.rejects(wrongShape.listings(),/unreadable response/);
});

test('production browse bounds response size and preserves safe upstream failures',async()=>{
  const oversized=productionAPI({origin:ORIGIN,fetcher:async()=>new Response('x'.repeat(2*1024*1024+1),{status:200})});await assert.rejects(oversized.listings(),error=>error.safe&&error.status===0&&/unreadable response/.test(error.message));
  const unavailable=productionAPI({origin:ORIGIN,fetcher:async()=>new Response('<h1>offline</h1>',{status:503,headers:{'Content-Type':'text/html'}})});await assert.rejects(unavailable.listings(),error=>error.safe&&error.status===503&&/temporarily unavailable/.test(error.message));
});

test('real public route output with a non-v4 provider ID is accepted by the production browser adapter',async()=>{
  const {photos,privateValue,...row}=listing,providerId='01890a5d-ac96-774b-bcce-b302099a8057';
  const handler=createGearListingsHandler({read:async()=>[{...row,trade:'',otherClub:'',photoRefs:[{id:PHOTO_ID,providerId}]}],now:()=>1700000000123});
  const api=productionAPI({origin:ORIGIN,fetcher:async()=>handler({env:{GEAR_DB:{},...DELIVERY}})}),result=await api.listings();
  assert.equal(result.listings.length,1);assert.equal(result.listings[0].id,ID);assert.equal(result.listings[0].trade,'');assert.equal(result.listings[0].otherClub,'');assert.equal(result.listings[0].photos.length,1);assert.match(result.listings[0].photos[0].url,/^https:\/\/imagedelivery\.net\//);assert.equal(Object.hasOwn(result.listings[0],'photoRefs'),false);
});
