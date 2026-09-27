import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {get} from 'node:https';
import {localServer} from '../scripts/gear/local-server.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {listingInput,previewListing,localAPI} from '../gear/local-api.mjs';
import {validateDraft} from '../lib/gear-validation.mjs';
import {normalize} from '../lib/gear-exchange.mjs';
const sample={title:'Club bag',description:'Worn',category:'Bags & accessories',size:'Junior',fit:'Junior',condition:'Used — good',city:'Seattle',clubs:['Other'],otherClub:'Test Club',seller:'Sample',email:'sample@example.test',photos:[]};
test('connected form contracts validate Sale, Free and Trade; edits never transfer mailbox or privilege fields',()=>{
 for(const [type,priceCents,trade] of [['Sale',4000,''],['Free',0,''],['Trade',null,'Larger bag']]){
  const draft={...sample,type,priceCents,trade,seller_id:'injected',status:'available'};
  const input=listingInput(draft,true);const validated=validateDraft(input);
  assert.equal(validated.type,type.toLowerCase());assert.equal(validated.priceCents,priceCents);assert.equal(validated.otherClub,'Test Club');assert.equal(validated.sellerName,sample.seller);
  const edit=listingInput(draft,true,true);assert.equal(Object.hasOwn(edit,'email'),false);assert.equal(Object.hasOwn(edit,'adult'),false);assert.equal(Object.hasOwn(edit,'seller_id'),false);assert.equal(Object.hasOwn(edit,'status'),false);
  const row=previewListing({...validated,id:'sample',status:'pending',expiresAt:100});assert.equal(row.type,type);assert.equal(row.pending,true);assert.equal(row.seller,sample.seller);assert.equal(row.expires,100);
 }
});
test('connected preview refuses plaintext mode',()=>{const db=openLocalDatabase();try{assert.throws(()=>localServer(db,{preview:true}),/requires TLS/);}finally{db.close();}});
test('opt-in HTTPS preview injects only HTML and serves an exact public asset list',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'gear-preview-test-'));const db=openLocalDatabase();let server;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key'),'-out',join(temp,'cert'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  server=localServer(db,{tls:{key:readFileSync(join(temp,'key')),cert:readFileSync(join(temp,'cert'))},preview:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const request=path=>new Promise((resolve,reject)=>{get({hostname:'127.0.0.1',port:server.address().port,path,rejectUnauthorized:false},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));}).on('error',reject);});
  const html=await request('/gear/');assert.equal(html.status,200);assert.match(html.body,/id="pi-gear-preview" data-local-api="true"/);assert.doesNotMatch(html.body,/fonts.googleapis.com/);assert.equal(html.headers['cache-control'],'no-store');
  const css=await request('/gear/gear.css');assert.equal(css.status,200);assert.doesNotMatch(css.body,/data-local-api="true"/);
  for(const path of ['/lib/gear-storage.mjs','/scripts/gear/local-server.mjs','/instructions/gear-management.md','/gear/../../.git/config','/.env'])assert.equal((await request(path)).status,404);
  assert.doesNotMatch(readFileSync(new URL('../gear/index.html',import.meta.url),'utf8'),/data-local-api/);
 }finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();rmSync(temp,{recursive:true,force:true});}
});

test('city grouping uses the same Unicode and whitespace normalization as search',()=>{
 assert.equal(normalize(' Mill  Creek '),normalize('mill creek'));
 assert.equal(normalize('Ｋｅｎｔ'),normalize('Kent'));
});
test('null and unreadable API responses produce safe generic errors',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{hostname:'127.0.0.1',protocol:'https:'}});
 try{
  for(const body of ['null','not-json']){
   t.mock.method(globalThis,'fetch',async()=>new Response(body,{status:502}));
   await assert.rejects(localAPI().request('/listings'),e=>e.safe===true&&e.message==='The server returned an unreadable response. Please try again.');
   t.mock.restoreAll();
  }
 }finally{if(original)Object.defineProperty(globalThis,'location',original);else delete globalThis.location;}
});
