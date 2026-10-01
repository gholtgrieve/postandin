import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {request as httpsRequest} from 'node:https';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {ownerAuth,OWNER_TTL_MS} from '../scripts/gear/owner-auth.mjs';
import {readOwnerKey} from '../scripts/gear/local-owner-key.mjs';
import {localModeration} from '../scripts/gear/local-moderation.mjs';
import {localReports,REPORT_WINDOW_MS} from '../scripts/gear/local-reports.mjs';
import {localServer} from '../scripts/gear/local-server.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink,changeListingState,editManagedListing} from '../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../lib/gear-email-change.mjs';
import {localContact} from '../scripts/gear/local-contact.mjs';
import {initializePhotos,photoContent} from '../scripts/gear/local-photos.mjs';
const key=()=>randomBytes(32).toString('hex'),status=n=>e=>e.status===n;
const sample={title:'Sample bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={}){const {id}=await createDraft(db,{...sample,...patch});const receipt=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,receipt.token)).verified,true);return id;}
async function seller(db){const link=await issueLocalManagementLink(db,sample.email);return redeemManagementLink(db,link.token);}
function setup(db){const secret=key(),auth=ownerAuth(secret),access=auth.login(secret),moderation=localModeration(db,auth),reports=localReports(db,{persistent:true});return {auth,access,moderation,reports};}
function report(queue,id,now=Date.now()){queue.submit({id,reason:'Other concern'},now);return queue.reports.at(-1).id;}
const act=(s,action,id,reason='Reviewed sample',now)=>s.moderation.act(s.access.token,s.access.csrf,{action,id,reason},now);
test('owner authentication is separate, bounded, expiring, revocable and rotated on sign-in',()=>{
 const secret=key(),auth=ownerAuth(secret),access=auth.login(secret,100);
 assert.throws(()=>auth.session(key(),101),status(401));assert.throws(()=>auth.authorize(access.token,key(),101),status(403));
 assert.equal(auth.authorize(access.token,access.csrf,101),'local-owner');assert.throws(()=>auth.session(access.token,99),status(401));
 assert.throws(()=>auth.session(access.token,100+OWNER_TTL_MS),status(401));
 const rotated=auth.login(secret,200);assert.throws(()=>auth.session(access.token,201),status(401));auth.logout(rotated.token,rotated.csrf,201);assert.throws(()=>auth.session(rotated.token,202),status(401));
 const blocked=ownerAuth(secret);for(let i=0;i<10;i++)assert.throws(()=>blocked.login(key(),100),status(401));assert.throws(()=>blocked.login(secret,599999),status(429));assert.ok(blocked.login(secret,600100).token);
 assert.throws(()=>ownerAuth('bad'));assert.throws(()=>ownerAuth(secret).session(rotated.token),status(401));
});
test('dismiss preserves listing; remove blocks public listing/contact/photos and seller changes; restore preserves pending and expiry',async()=>{
 const db=openLocalDatabase();try{
  const s=setup(db),id=await publish(db),access=await seller(db);initializePhotos(db);
  const photoId=crypto.randomUUID();db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(photoId,id,0,Buffer.from('sample'),Date.now());
  let rid=report(s.reports,id);act(s,'dismiss',rid);assert.equal((await readPublicListings(db)).length,1);assert.throws(()=>act(s,'dismiss',rid),status(409));
  await changeListingState(db,access.session,access.csrf,id,'pending');const before=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);
  rid=report(s.reports,id);assert.throws(()=>s.moderation.act(access.session,access.csrf,{action:'remove',id:rid,reason:'Not owner'}),status(401));
  act(s,'remove',rid);assert.equal((await readPublicListings(db)).length,0);assert.equal(photoContent(db,photoId,'',false),null);
  assert.throws(()=>localContact(db).send({id,name:'Buyer',email:'buyer@example.test',message:'Hi'}),status(404));
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist'),false);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,sample),false);
  assert.throws(()=>act(s,'remove',rid),status(409));act(s,'restore',id);
  const after=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);assert.deepEqual(after,before);assert.ok(photoContent(db,photoId,'',false));
  assert.throws(()=>act(s,'restore',id),status(409));
  const view=s.moderation.view(s.access.token);assert.deepEqual(view.history.map(h=>h.action),['restore','remove','dismiss']);assert.equal(view.history.every(h=>h.actor==='local-owner'),true);assert.equal(view.removed.length,0);assert.equal(JSON.stringify(view).includes('@'),false);
 }finally{db.close();}
});
test('invalid actions/reasons and stale reports have no side effects; audit failure rolls back listing and resolution',async()=>{
 const db=openLocalDatabase();try{
  const s=setup(db),id=await publish(db),rid=report(s.reports,id);
  for(const input of [null,{},[],{action:'purge',id:rid,reason:'x'},{action:'remove',id:rid,reason:' '},{action:'remove',id:rid,reason:'x'.repeat(501)},{action:'remove',id:rid,reason:'a\nb'}])assert.throws(()=>s.moderation.act(s.access.token,s.access.csrf,input),status(400));
  assert.throws(()=>act(s,'dismiss',crypto.randomUUID()),status(409));assert.throws(()=>s.moderation.act(s.access.token,key(),{action:'remove',id:rid,reason:'x'}),status(403));
  db.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON gear_local_moderation_history BEGIN SELECT RAISE(ABORT,'private audit failure'); END;");
  assert.throws(()=>act(s,'remove',rid));assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');assert.equal(s.moderation.view(s.access.token).reports[0].resolution,'open');assert.equal(s.moderation.view(s.access.token).removed.length,0);
  db.sqlite.exec('DROP TRIGGER fail_audit');act(s,'remove',rid);
  db.sqlite.exec("CREATE TRIGGER fail_restore_audit BEFORE INSERT ON gear_local_moderation_history BEGIN SELECT RAISE(ABORT,'private failure'); END;");
  assert.throws(()=>act(s,'restore',id));assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');assert.equal(s.moderation.view(s.access.token).removed.length,1);
 }finally{db.close();}
});
test('restore rejects expiry, verification loss, active duplicates and quota without consuming removal',async()=>{
 const db=openLocalDatabase();try{
  const s=setup(db),id=await publish(db);act(s,'remove',report(s.reports,id));
  const expiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at,now=Date.now();
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now,id);assert.throws(()=>act(s,'restore',id,'Reviewed',now),status(409));db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(expiry,id);
  const verified=db.sqlite.prepare('SELECT verified_at FROM gear_sellers').get().verified_at;db.sqlite.exec('UPDATE gear_sellers SET verified_at=NULL');assert.throws(()=>act(s,'restore',id),status(409));db.sqlite.prepare('UPDATE gear_sellers SET verified_at=?').run(verified);
  const duplicate=await publish(db);assert.throws(()=>act(s,'restore',id),status(409));db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(duplicate);
  for(let i=0;i<10;i++)await publish(db,{title:'Other '+i});assert.throws(()=>act(s,'restore',id),status(409));
  db.sqlite.exec("UPDATE gear_listings SET status='closed' WHERE title='Other 0'");act(s,'restore',id);assert.equal(s.moderation.view(s.access.token).removed.length,0);
 }finally{db.close();}
});
test('restore follows transferred ownership, cleans stale duplicate atomically, and never extends expiry',async()=>{
 const db=openLocalDatabase();try{
  const s=setup(db),id=await publish(db),access=await seller(db);act(s,'remove',report(s.reports,id));
  const transfer=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test');assert.equal(await confirmEmailChange(db,transfer.token),true);
  const duplicate=await publish(db,{email:'new@example.test'}),now=Date.now();db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now,duplicate);
  const expiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at;
  db.sqlite.exec("CREATE TRIGGER fail_stale_restore BEFORE INSERT ON gear_local_moderation_history BEGIN SELECT RAISE(ABORT,'sample audit failure'); END;");
  assert.throws(()=>act(s,'restore',id,'Eligible again',now));assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(duplicate).status,'available');
  db.sqlite.exec('DROP TRIGGER fail_stale_restore');
  act(s,'restore',id,'Eligible again',now);assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(duplicate).status,'expired');assert.equal(db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at,expiry);
 }finally{db.close();}
});
test('owner-mode queue, resolution, removal and audit persist across reopen; evicted reports cannot be acted on',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'gear-owner-db-')),path=join(temp,'sample.sqlite');let db=openLocalDatabase(path);
 try{
  let s=setup(db);const id=await publish(db),now=Date.now(),rid=report(s.reports,id,now);act(s,'remove',rid);
  db.close();db=openLocalDatabase(path);s=setup(db);assert.equal(s.moderation.view(s.access.token).removed.length,1);assert.equal(s.moderation.view(s.access.token).reports[0].resolution,'removed');assert.equal(s.moderation.view(s.access.token).history.length,1);
  act(s,'restore',id);for(let i=1;i<=21;i++)report(s.reports,id,now+i*REPORT_WINDOW_MS);
  assert.equal(s.reports.reports.length,20);assert.throws(()=>act(s,'dismiss',rid),status(409));assert.equal(s.moderation.view(s.access.token).history.length,2);
 }finally{db.close();rmSync(temp,{recursive:true,force:true});}
});
test('local owner key file is exclusive, private, outside checkout and never printed',()=>{
 const temp=mkdtempSync(join(tmpdir(),'gear-owner-key-')),path=join(temp,'owner.key');try{
  const output=execFileSync(process.execPath,['scripts/gear/local-owner-key.mjs',path],{encoding:'utf8'});const secret=readOwnerKey(path);assert.equal(output.includes(secret),false);
  assert.throws(()=>execFileSync(process.execPath,['scripts/gear/local-owner-key.mjs',path],{stdio:'ignore'}));assert.equal(readOwnerKey(path),secret);
  chmodSync(path,0o644);assert.throws(()=>readOwnerKey(path));chmodSync(path,0o600);writeFileSync(path,'invalid');assert.throws(()=>readOwnerKey(path));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('HTTPS owner routes require separate cookie, Origin and CSRF; alternate queue is closed and errors stay generic',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'gear-owner-http-')),db=openLocalDatabase();let server;
 try{
  const secret=key();assert.throws(()=>localServer(db,{ownerKey:secret}),/requires TLS/);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key'),'-out',join(temp,'cert'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
  server=localServer(db,{ownerKey:secret,tls:{key:readFileSync(join(temp,'key')),cert:readFileSync(join(temp,'cert'))},preview:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,origin=`https://127.0.0.1:${port}`;
  const req=(path,body,headers={})=>new Promise((resolve,reject)=>{const request=httpsRequest({hostname:'127.0.0.1',port,path,method:body===undefined?'GET':'POST',rejectUnauthorized:false,headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...headers}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));});
  const page=await req('/owner/');assert.equal(page.status,200);assert.match(page.body,/name="robots" content="noindex,nofollow"/);assert.equal(page.headers['x-robots-tag'],'noindex, nofollow');
  for(const path of ['/owner/unknown','/owner/login','/scripts/gear/owner-auth.mjs','/.git/config'])assert.equal((await req(path)).status,404);
  assert.doesNotMatch(readFileSync('sitemap.xml','utf8'),/owner/);assert.doesNotMatch(readFileSync('index.html','utf8'),/href=["'][^"']*owner/);assert.ok(readFileSync('404.html','utf8').length);
  assert.doesNotMatch(readFileSync('robots.txt','utf8'),/Disallow: \/(?:owner|gear)/);assert.equal((await req('/local/reports')).status,404);assert.equal((await req('/owner/data')).status,401);
  assert.equal((await req('/owner/login',{key:secret},{Origin:''})).status,403);assert.equal((await req('/owner/login',{key:secret},{Origin:'null'})).status,403);
  const signed=await req('/owner/login',{key:secret});assert.equal(signed.status,200);const cookie=signed.headers['set-cookie'][0].split(';')[0],csrf=JSON.parse(signed.body).csrf;
  assert.match(signed.headers['set-cookie'][0],/Path=\/owner; HttpOnly; Secure; SameSite=Strict/);assert.equal(signed.body.includes(secret),false);
  assert.equal((await req('/owner/data',undefined,{Cookie:cookie+'; '+cookie})).status,401);assert.equal((await req('/owner/data',undefined,{Cookie:cookie})).status,200);
  const id=await publish(db),sellerAccess=await seller(db);assert.equal((await req('/owner/data',undefined,{Cookie:'gear_session='+sellerAccess.session})).status,401);
  await req('/reports',{id,reason:'Other concern'});const rid=JSON.parse((await req('/owner/data',undefined,{Cookie:cookie})).body).reports[0].id,body={id:rid,action:'remove',reason:'Owner reviewed'};
  assert.equal((await req('/owner/action',body,{Cookie:cookie})).status,403);assert.equal((await req('/owner/action',body,{Cookie:cookie,'X-Gear-CSRF':csrf,Origin:'https://example.test'})).status,403);
  db.sqlite.exec("CREATE TRIGGER fail_http_audit BEFORE INSERT ON gear_local_moderation_history BEGIN SELECT RAISE(ABORT,'private upstream detail'); END;");const logged=console.error;console.error=()=>{};
  try{const failed=await req('/owner/action',body,{Cookie:cookie,'X-Gear-CSRF':csrf});assert.equal(failed.status,500);assert.deepEqual(JSON.parse(failed.body),{error:'Unable to process the request.'});}finally{console.error=logged;db.sqlite.exec('DROP TRIGGER fail_http_audit');}
  assert.equal((await req('/owner/action',body,{Cookie:cookie,'X-Gear-CSRF':csrf})).status,200);
  assert.equal((await req('/owner/logout',{}, {Cookie:cookie,'X-Gear-CSRF':csrf})).status,200);assert.equal((await req('/owner/data',undefined,{Cookie:cookie})).status,401);
 }finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();rmSync(temp,{recursive:true,force:true});}
});
