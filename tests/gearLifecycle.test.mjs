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
  assert.deepEqual(cleanup(db,{now:now+RECOVERY_MS-1}),{dueListings:0,applied:false});assert.equal(cleanup(db,{now:now+RECOVERY_MS}).dueListings,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,1);
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
