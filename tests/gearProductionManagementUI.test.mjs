import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listingInput,preparePhoto,previewListing,productionAPI,takeManagementToken} from '../gear/production-api.mjs';

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
  await api.write({id:ID,action:'pending'});
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

test('management separates browsing from explicit sign out',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/browse\.textContent='← All listings'/);
  assert.match(source,/browse\.onclick=\(\)=>go\('gear'\)/);
  assert.match(source,/logout\.textContent='Sign out'/);
  assert.match(source,/go\('gear'\);location\.replace\(new URL\('\/gear\/',location\.origin\)\.href\)/);
});

test('connected navigation has explicit site, browse, manage and cancel destinations',()=>{
  const html=readFileSync(new URL('../gear/index.html',import.meta.url),'utf8');
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/connectedMode&&target==='home'/);
  assert.match(source,/location\.assign\(new URL\('\/',location\.origin\)\.href\)/);
  assert.match(html,/id="pi-post-cancel">Cancel/);
  assert.equal((html.match(/data-post-cancel/g)||[]).length,2);
  assert.match(source,/querySelectorAll\('#pi-post-cancel,\[data-post-cancel\]'\)/);
});

test('connected navigation participates in browser history',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/const navigationScreens=new Set\(\['gear','detail','post','manage'\]\)/);
  assert.match(source,/history\[mode==='replace'\?'replaceState':'pushState'\]\(snapshot,'',location\.href\)/);
  assert.match(source,/window\.addEventListener\('popstate'/);
  assert.match(source,/navigationScreens\.has\(event\.state\?\.gearScreen\)\?event\.state\.gearScreen:'gear'/);
  assert.match(source,/go\(screen,\{historyMode:'none'\}\)/);
  assert.match(source,/resetContact\(\);go\('detail'\)/);
});

test('session refresh distinguishes authentication loss from a temporary failure',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/catch\(error\)\{if\(error\.status===401\)clearLocalAccess\(\);else throw error;\}/);
  assert.match(source,/\$\('#pi-local-logout'\)\.hidden=!signedIn/);
  assert.match(source,/if\(editingId\)resetPost\(\)/);
  assert.match(source,/expiredEdit=state\.screen==='post'&&Boolean\(editingId\)/);
  assert.match(source,/if\(expiredEdit\)go\('manage',\{historyMode:'replace'\}\)/);
  assert.match(source,/if\(expiredEdit\)\$\('#pi-post-email'\)\.disabled=false/);
  assert.match(source,/if\(error\.status===401\)throw error;showStatus/);
  assert.match(source,/managementScope=productionMode&&result\.scope==='listing'\?'listing':'seller'/);
  assert.match(source,/\$\('#pi-active-count'\)\.hidden=!signedIn;\$\('#pi-new-listing'\)\.hidden=!signedIn\|\|managementScope==='listing'\|\|\(productionMode&&!postingAvailable\)/);
  assert.match(source,/Managing one listing — use “Need a new management link\?” below to see all/);
  assert.match(source,/postingAvailable=true;renderManaged\(\)/);
});

test('saved management links require an explicit confirmation before redemption',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/else if\(productionMode&&managementToken\)showManagementConfirmation\(\)/);
  assert.match(source,/verifyMode='management'/);
  assert.match(source,/Continue to Gear management\?/);
  assert.match(source,/Continue only if you opened this private link yourself/);
  assert.match(source,/replaces any current Gear management session in this browser/);
  assert.match(source,/may sign out another device already managing the same listings/);
  assert.match(source,/This management link no longer works\. Request a temporary access link below\./);
  assert.match(source,/else if\(verifyMode==='management'\)localAction\(confirmManagementLink\)/);
  assert.doesNotMatch(source,/productionMode&&managementToken\)await localAction/);
  assert.match(source,/sellerWide=signedIn&&managementScope==='seller'&&managed\.some\(listing=>listing\.id===result\.listingId\)/);
  assert.match(source,/You can manage it here/);
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
  await assert.rejects(api.uploadPhoto(ID,new File([], 'empty.jpg',{type:'image/jpeg'})),/supported photo/);assert.equal(calls,0);
  await assert.rejects(api.uploadPhoto(ID,new File(['x'],'gear.gif',{type:'image/gif'})),/supported photo/);assert.equal(calls,0);
  await assert.rejects(api.uploadPhoto(ID,new File(['x'],'gear.jpg',{type:'image/jpeg'})),/unreadable response/);assert.equal(calls,2);
});

test('photo upload accepts phone HEIC metadata and extension fallback',async()=>{
  for(const file of [new File(['x'],'phone.heic',{type:'image/heic'}),new File(['x'],'PHONE.HEIF'),new File(['x'],'camera.JPG',{type:'image/jpg'})]){
    let direct=false;const api=productionAPI({origin:'https://postandin.com',fetcher:async(url)=>{
      if(String(url).endsWith('/session'))return json(200,{csrf:CSRF});
      if(String(url).endsWith('/photos/upload'))return json(201,{quarantineProviderId:ID,uploadURL:'https://upload.imagedelivery.net/direct'});
      if(String(url)==='https://upload.imagedelivery.net/direct'){direct=true;return new Response('',{status:200});}
      if(String(url).endsWith('/photos/finalize'))return json(200,{ok:true});
    }});
    await api.uploadPhoto(ID,file);assert.equal(direct,true);
  }
});

test('oversized phone photos are prepared automatically without changing the original',async()=>{
  const original=new File([new Uint8Array(10_000_001)],'2026-10-01 14.43.32.jpg',{type:'image/jpeg',lastModified:123});
  let closed=false,drawn=null;const canvas={width:0,height:0,getContext:()=>({drawImage(...args){drawn=args;}}),toBlob(callback,type,quality){assert.equal(type,'image/jpeg');assert.equal(quality,0.86);callback(new Blob(['prepared'],{type}));}};
  const prepared=await preparePhoto(original,{createBitmap:async()=>({width:6000,height:4000,close(){closed=true;}}),createCanvas:()=>canvas});
  assert.notEqual(prepared,original);assert.equal(original.size,10_000_001);assert.equal(prepared.name,'2026-10-01 14.43.32.jpg');assert.equal(prepared.type,'image/jpeg');assert.equal(prepared.lastModified,123);
  assert.equal(canvas.width,2400);assert.equal(canvas.height,1600);assert.deepEqual(drawn.slice(1),[0,0,2400,1600]);assert.equal(closed,true);
  const small=new File(['small'],'small.jpg',{type:'image/jpeg'});assert.equal(await preparePhoto(small),small);
});

test('photo management is focused, supports multi-select and reports progress',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  const styles=readFileSync(new URL('../gear/gear.css',import.meta.url),'utf8');
  assert.match(source,/button\('photos','Manage photos'\)/);
  assert.match(source,/id="pi-stored-upload"[^>]+multiple/);
  assert.match(source,/Uploading \$\{i\+1\} of \$\{files\.length\}/);
  assert.match(source,/status\.classList\.toggle\('is-busy',busy\)/);
  assert.match(source,/input\.disabled=busy/);
  assert.match(source,/id="pi-photo-done">Done/);
  assert.match(source,/photos added and saved\./);
  assert.match(source,/button\('remove','Remove listing'\)/);
  assert.match(source,/This hides the listing now\. You can recover it for 30 days\./);
  assert.doesNotMatch(source,/button\('close','Close listing'\)/);
  assert.doesNotMatch(source,/button\('delete','Delete'\)/);
  assert.match(source,/← My listings/);
  assert.match(styles,/\.pi-manage\.pi-photo-mode>:not\(#pi-photo-manager\)/);
  assert.match(styles,/\.pi-photo-upload-status\.is-busy::before/);
  assert.match(styles,/@keyframes pi-photo-spin/);
});

test('connected Gear hides developer preview navigation',()=>{
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  assert.match(source,/\$\('\.pi-preview-bar'\)\.hidden=true/);
});

test('production projections preserve only fields needed by the existing editor',()=>{
  const row=previewListing({id:ID,type:'sale',sellerName:'Alex',city:'Seattle',status:'available',expiresAt:99,photos:[{id:ID,url:'https://example.test/photo'}]});
  assert.equal(row.type,'Sale');assert.equal(row.seller,'Alex');assert.equal(row.status,'Available');assert.equal(row.expires,99);
  const input=listingInput({...row,title:'Bag',description:'Good bag',category:'Bundles',size:'Junior',fit:'Junior',condition:'Used — good',priceCents:1200,trade:null,clubs:[],otherClub:''});
  assert.equal(Object.hasOwn(input,'email'),false);assert.equal(Object.hasOwn(input,'adult'),false);assert.equal(Object.hasOwn(input,'photos'),false);assert.equal(input.sellerName,'Alex');
});
