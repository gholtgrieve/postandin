import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {initializeLifecycle,changeDeletion,deletedListings,cleanup,RECOVERY_MS} from '../scripts/gear/local-lifecycle.mjs';
import {createBackup,restoreBackup,pruneBackups} from '../scripts/gear/local-backup.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink,changeListingState} from '../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../lib/gear-email-change.mjs';
import {initializePhotos,photoContent} from '../scripts/gear/local-photos.mjs';
import {ownerAuth} from '../scripts/gear/owner-auth.mjs';
import {localModeration} from '../scripts/gear/local-moderation.mjs';
import {localReports} from '../scripts/gear/local-reports.mjs';
import {localServer} from '../scripts/gear/local-server.mjs';
const sample={title:'Bag',description:'Sample wear',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={}){const {id}=await createDraft(db,{...sample,...patch});const receipt=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,receipt.token)).verified,true);return id;}
async function login(db,email=sample.email){const link=await issueLocalManagementLink(db,email);return redeemManagementLink(db,link.token);}
const status=n=>e=>e.status===n;
function setup(db){initializeLifecycle(db);initializePhotos(db);}
const change=(db,access,id,action,now)=>changeDeletion(db,access.session,access.csrf,{id,action},now);
test('delete hides public and private photos; ownership/CSRF/replay guards and recovery preserve listing expiry',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const id=await publish(db),access=await login(db),photo=crypto.randomUUID(),expiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at;
  db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(photo,id,0,Buffer.from('pixels'),Date.now());
  assert.throws(()=>changeDeletion(db,access.session,'bad',{id,action:'delete'}),status(403));const other=await publish(db,{email:'other@example.test'}),otherAccess=await login(db,'other@example.test');assert.throws(()=>change(db,otherAccess,id,'delete'),status(403));
  change(db,access,id,'delete');assert.equal((await readPublicListings(db)).some(r=>r.id===id),false);assert.equal(photoContent(db,photo,access.session,true),null);assert.equal(photoContent(db,photo,'',false),null);assert.equal(deletedListings(db,access.session).length,1);assert.equal(deletedListings(db,otherAccess.session).length,0);
  assert.throws(()=>change(db,access,id,'delete'),status(409));assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist'),false);
  change(db,access,id,'restore');assert.equal(deletedListings(db,access.session).length,0);assert.equal(db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at,expiry);assert.ok(photoContent(db,photo,access.session,true));assert.throws(()=>change(db,access,id,'restore'),status(409));
 }finally{db.close();}
});
test('exact recovery deadline, expired listing recovery, duplicates and transfer ownership',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const id=await publish(db),a=await login(db),now=Date.now();change(db,a,id,'delete',now);
  // Session lifetime is separate from the 30-day recovery window.
  db.sqlite.prepare('UPDATE gear_management_sessions SET expires_at=?').run(now+RECOVERY_MS+1000);
  assert.throws(()=>change(db,a,id,'restore',now+RECOVERY_MS),status(409));
  const dup=await publish(db);assert.throws(()=>change(db,a,id,'restore',now+1),status(409));db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(dup);
  const transfer=await issueLocalEmailChange(db,a.session,a.csrf,'new@example.test');assert.equal(await confirmEmailChange(db,transfer.token),true);const b=await login(db,'new@example.test');
  assert.throws(()=>deletedListings(db,a.session),status(401));assert.equal(deletedListings(db,b.session)[0].id,id);
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(now,id);change(db,b,id,'restore');assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'expired');
 }finally{db.close();}
});
test('seller recovery cannot undo moderation; owner restore cannot override seller deletion',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const secret=randomBytes(32).toString('hex'),auth=ownerAuth(secret),owner=auth.login(secret),mod=localModeration(db,auth),queue=localReports(db,{persistent:true}),id=await publish(db),access=await login(db);
  queue.submit({id,reason:'Other concern'});mod.act(owner.token,owner.csrf,{id:queue.reports[0].id,action:'remove',reason:'Owner decision'});
  change(db,access,id,'delete');assert.throws(()=>mod.act(owner.token,owner.csrf,{id,action:'restore',reason:'Cannot bypass deletion'}),status(409));
  change(db,access,id,'restore');assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');mod.act(owner.token,owner.csrf,{id,action:'restore',reason:'Eligible again'});assert.equal((await readPublicListings(db)).length,1);
 }finally{db.close();}
});
test('purge is explicit, exact-deadline and transactional; erases content/photos/seller data but retains minimal ledger',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const id=await publish(db),access=await login(db),now=Date.now(),photo=crypto.randomUUID();db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(photo,id,0,Buffer.from('pixels'),now);
  const queue=localReports(db,{persistent:true});queue.submit({id,reason:'Other concern'});change(db,access,id,'delete',now);
  assert.equal(cleanup(db,{now:now+RECOVERY_MS-1}).dueListings,0);assert.equal(cleanup(db,{now:now+RECOVERY_MS}).dueListings,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,1);
  db.sqlite.exec("CREATE TRIGGER fail_purge BEFORE DELETE ON gear_listings BEGIN SELECT RAISE(ABORT,'sample failure'); END;");assert.throws(()=>cleanup(db,{apply:true,now:now+RECOVERY_MS}));assert.equal(queue.reports.length,1);db.sqlite.exec('DROP TRIGGER fail_purge');
  cleanup(db,{apply:true,now:now+RECOVERY_MS});for(const table of ['gear_listings','gear_local_photos','gear_local_reports','gear_sellers','gear_management_sessions','gear_verification_tokens'])assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
  assert.deepEqual(Object.keys(db.sqlite.prepare('SELECT * FROM gear_local_deletion_ledger').get()).sort(),['listing_id','deleted_at','purge_at','purged_at'].sort());assert.equal(cleanup(db,{apply:true,now:now+RECOVERY_MS}).dueListings,0);
 }finally{db.close();}
});
test('snapshot restores records/photos, revokes credentials and never overwrites source or target',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-backup-test-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite'),target=join(dir,'restored.sqlite');const db=openLocalDatabase(path);let restored;
 try{
  setup(db);const id=await publish(db),access=await login(db),photo=crypto.randomUUID();db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(photo,id,0,Buffer.from('sample pixels'),Date.now());
  await createBackup(path,snapshot);assert.equal(statSync(snapshot).mode&0o777,0o600);const bytes=readFileSync(snapshot);await assert.rejects(createBackup(path,snapshot));assert.deepEqual(readFileSync(snapshot),bytes);
  await restoreBackup(snapshot,target,path);restored=openLocalDatabase(target);assert.equal((await readPublicListings(restored))[0].id,id);assert.deepEqual(Buffer.from(photoContent(restored,photo,'',false)),Buffer.from('sample pixels'));assert.throws(()=>deletedListings(restored,access.session),status(401));
  assert.equal(restored.sqlite.prepare('SELECT count(*) AS n FROM gear_verification_tokens').get().n,0);await assert.rejects(restoreBackup(snapshot,path,path));assert.equal((await readPublicListings(db)).length,1);
 }finally{restored?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('restore reconciles newer deletion and moderation and excludes permanently purged snapshot content',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-restore-ledger-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite');const db=openLocalDatabase(path);let restored;
 try{
  setup(db);const secret=randomBytes(32).toString('hex'),auth=ownerAuth(secret),owner=auth.login(secret),mod=localModeration(db,auth),queue=localReports(db,{persistent:true}),id=await publish(db),access=await login(db),now=Date.now();await createBackup(path,snapshot);
  queue.submit({id,reason:'Other concern'});mod.act(owner.token,owner.csrf,{id:queue.reports[0].id,action:'remove',reason:'Newer owner restriction'});change(db,access,id,'delete',now);
  const pending=join(dir,'pending.sqlite');await restoreBackup(snapshot,pending,path,now+1);restored=openLocalDatabase(pending);assert.equal((await readPublicListings(restored)).length,0);assert.equal(restored.sqlite.prepare('SELECT previous_status FROM gear_local_deletions').get().previous_status,'removed');assert.equal(restored.sqlite.prepare('SELECT count(*) AS n FROM gear_local_removals').get().n,1);restored.close();restored=null;
  cleanup(db,{apply:true,now:now+RECOVERY_MS});const recentSnapshot=join(dir,'recent.sqlite');await createBackup(snapshot,recentSnapshot).then(()=>assert.fail('must reject re-backup'),()=>{});
  const snapDb=openLocalDatabase(snapshot);snapDb.sqlite.prepare('UPDATE gear_local_snapshot SET created_at=?,expires_at=?').run(now+1,now+1+RECOVERY_MS);snapDb.close();
  const purged=join(dir,'purged.sqlite');await restoreBackup(snapshot,purged,path,now+RECOVERY_MS);restored=openLocalDatabase(purged);assert.equal(restored.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,0);assert.equal(restored.sqlite.prepare('SELECT count(*) AS n FROM gear_sellers').get().n,0);
 }finally{restored?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('deletion HTTP requires cookie, Origin and CSRF, filters management and safely exposes recovery list',async()=>{
 const db=openLocalDatabase(),server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const id=await publish(db),access=await login(db),cookie='gear_session='+access.session;
  const post=(headers={})=>fetch(base+'/management/deletion',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify({id,action:'delete'})});
  assert.equal((await post()).status,401);assert.equal((await post({Cookie:cookie})).status,403);assert.equal((await post({Cookie:cookie,'X-Gear-CSRF':access.csrf,Origin:'null'})).status,403);assert.equal((await post({Cookie:cookie,'X-Gear-CSRF':access.csrf})).status,200);
  assert.equal((await fetch(base+'/management/deleted')).status,401);assert.equal((await(await fetch(base+'/management/listings',{headers:{Cookie:cookie}})).json()).listings.length,0);
  const trash=await(await fetch(base+'/management/deleted',{headers:{Cookie:cookie}})).json();assert.equal(trash.listings[0].id,id);assert.equal(JSON.stringify(trash).includes('@'),false);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('snapshots expire by their earliest deletion deadline; prune is preview-first and ignores working databases',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-prune-test-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'sample.sqlite'),target=join(dir,'restore.sqlite');const db=openLocalDatabase(path);
 try{
  setup(db);const id=await publish(db),access=await login(db),now=Date.now();change(db,access,id,'delete',now);
  await createBackup(path,snapshot,now+1000);
  assert.equal(pruneBackups(dir,{now:now+RECOVERY_MS-1}).expiredSnapshots,0);assert.equal(pruneBackups(dir,{now:now+RECOVERY_MS}).expiredSnapshots,1);assert.equal(existsSync(snapshot),true);
  await assert.rejects(restoreBackup(snapshot,target,path,now+RECOVERY_MS),/retention/);assert.equal(existsSync(target),false);
  assert.equal(pruneBackups(dir,{apply:true,now:now+RECOVERY_MS}).expiredSnapshots,1);assert.equal(existsSync(snapshot),false);assert.equal(existsSync(path),true);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('short retention removes only due drafts, invalid credentials and old history, preserving active removal and other listings',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const id=await publish(db),access=await login(db),now=Date.now();
  const old=await createDraft(db,{...sample,title:'Abandoned'}),fresh=await createDraft(db,{...sample,title:'Recent'});
  db.sqlite.prepare('UPDATE gear_listings SET created_at=? WHERE id=?').run(now-3*86400000,old.id);
  db.sqlite.prepare('UPDATE gear_listings SET created_at=? WHERE id=?').run(now-3*86400000+1,fresh.id);
  const secret=randomBytes(32).toString('hex'),auth=ownerAuth(secret),owner=auth.login(secret),mod=localModeration(db,auth),queue=localReports(db,{persistent:true});
  queue.submit({id,reason:'Other concern'});mod.act(owner.token,owner.csrf,{id:queue.reports[0].id,action:'remove',reason:'Private reason'});
  for(const table of ['gear_local_reports','gear_local_moderation_history'])db.sqlite.prepare('UPDATE '+table+' SET created_at=?').run(now-RECOVERY_MS);
  db.sqlite.prepare('UPDATE gear_local_removals SET removed_at=?').run(now-RECOVERY_MS);
  await issueLocalEmailChange(db,access.session,access.csrf,'changed@example.test');
  db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=?').run(now);
  const preview=cleanup(db,{now});assert.equal(preview.dueDrafts,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,3);
  db.sqlite.exec("CREATE TRIGGER fail_retention BEFORE DELETE ON gear_management_sessions BEGIN SELECT RAISE(ABORT,'test'); END");
  assert.throws(()=>cleanup(db,{apply:true,now}));assert.ok(db.sqlite.prepare('SELECT id FROM gear_listings WHERE id=?').get(old.id));db.sqlite.exec('DROP TRIGGER fail_retention');
  cleanup(db,{apply:true,now});
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,2);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_sellers').get().n,1);
  for(const table of ['gear_email_changes','gear_management_sessions','gear_verification_tokens','gear_local_reports','gear_local_moderation_history'])assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n,0,table);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_links').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');assert.match(db.sqlite.prepare('SELECT reason FROM gear_local_removals').get().reason,/original reason expired/);
 }finally{db.close();}
});
test('local cleanup preserves recovery accounting until its anchored window ends',async()=>{
 const db=openLocalDatabase();try{
  setup(db);await publish(db);const windowStart=10*86400000,link=await issueLocalManagementLink(db,sample.email,windowStart);assert.ok(link);assert.ok(await redeemManagementLink(db,link.token,windowStart+1));
  cleanup(db,{apply:true,now:windowStart+86400000-1});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_links').get().n,1);
  cleanup(db,{apply:true,now:windowStart+86400000});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_links').get().n,0);
  const live=await issueLocalManagementLink(db,sample.email,windowStart+86400000);assert.ok(live);
  db.sqlite.prepare('UPDATE gear_management_links SET window_started_at=0,expires_at=?').run(windowStart+2*86400000+1);
  cleanup(db,{apply:true,now:windowStart+2*86400000});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_links').get().n,1);
 }finally{db.close();}
});
test('purge ledger expires after 30 days without extending purge time on restore reconciliation',async()=>{
 const db=openLocalDatabase();try{
  setup(db);const id=await publish(db),access=await login(db),now=Date.now();change(db,access,id,'delete',now);
  cleanup(db,{apply:true,now:now+RECOVERY_MS});
  cleanup(db,{apply:true,now:now+2*RECOVERY_MS-1});assert.equal(db.sqlite.prepare('SELECT purged_at FROM gear_local_deletion_ledger').get().purged_at,now+RECOVERY_MS);
  cleanup(db,{apply:true,now:now+2*RECOVERY_MS});assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_deletion_ledger').get().n,0);
 }finally{db.close();}
});
test('snapshot deadline respects draft retention and omits credentials without changing source',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-short-backup-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite');const db=openLocalDatabase(path);let copy;
 try{
  setup(db);await publish(db);await login(db);const draft=await createDraft(db,{...sample,title:'Unfinished'}),now=Date.now();db.sqlite.prepare('UPDATE gear_listings SET created_at=? WHERE id=?').run(now-2*86400000,draft.id);
  await createBackup(path,snapshot,now);copy=openLocalDatabase(snapshot);
  assert.equal(copy.sqlite.prepare('SELECT expires_at FROM gear_local_snapshot').get().expires_at,now+86400000);
  assert.equal(copy.sqlite.prepare('SELECT count(*) AS n FROM gear_management_sessions').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_sessions').get().n,1);
 }finally{copy?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('restore never gives a still-valid private removal reason a fresh retention clock',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-reason-retention-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite'),target=join(dir,'restored.sqlite');const db=openLocalDatabase(path);let restored;
 try{
  setup(db);const id=await publish(db),now=Date.now(),secret=randomBytes(32).toString('hex'),auth=ownerAuth(secret),owner=auth.login(secret),mod=localModeration(db,auth),queue=localReports(db,{persistent:true});
  queue.submit({id,reason:'Other concern'});mod.act(owner.token,owner.csrf,{id:queue.reports[0].id,action:'remove',reason:'PRIVATE-REASON-TEXT'});
  db.sqlite.prepare('UPDATE gear_local_removals SET removed_at=?').run(now-29*86400000);
  db.sqlite.prepare('UPDATE gear_local_moderation_history SET created_at=?').run(now-29*86400000);
  await createBackup(path,snapshot,now);await restoreBackup(snapshot,target,path,now);restored=openLocalDatabase(target);
  assert.equal(restored.sqlite.prepare("SELECT reason FROM gear_local_moderation_history WHERE action='preserve-removal'").get().reason,'Removal preserved from current database during restore.');
  cleanup(restored,{apply:true,now:now+2*86400000});
  assert.equal(JSON.stringify(restored.sqlite.prepare('SELECT * FROM gear_local_moderation_history').all()).includes('PRIVATE-REASON-TEXT'),false);
  assert.equal(restored.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'removed');
  assert.match(restored.sqlite.prepare('SELECT reason FROM gear_local_removals').get().reason,/original reason expired/);
 }finally{restored?.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
