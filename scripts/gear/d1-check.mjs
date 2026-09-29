// Optional local D1/workerd integration check. No remote resources or repo dependencies.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDraft,readPublicListings} from '../../lib/gear-storage.mjs';
import {recordHostedPhoto,readHostedPhotos} from '../../lib/gear-photo-storage.mjs';
import {readOpenModerationReports} from '../../lib/gear-moderation-storage.mjs';
import {submitReport} from '../../lib/gear-report-storage.mjs';
import {moderateListing} from '../../lib/gear-moderation-actions.mjs';
import {changeSellerDeletion} from '../../lib/gear-seller-deletion.mjs';
import {issueLocalVerification,confirmVerification} from '../../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink,recoverManagementSession,listManaged,editManagedListing,changeListingState} from '../../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../../lib/gear-email-change.mjs';
const modulePath=process.env.GEAR_WRANGLER_MODULE;
if(!modulePath)throw new Error('Set GEAR_WRANGLER_MODULE to an installed Wrangler module absolute path.');
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve(modulePath));
const {Miniflare}=wranglerRequire('miniflare');
const {unstable_splitSqlQuery:splitSQL}=require(modulePath);
const temp=mkdtempSync(join(tmpdir(),'gear-d1-'));
let mf;let cleanupPromise;
function cleanup(){return cleanupPromise??=Promise.resolve().then(()=>mf?.dispose()).finally(()=>rmSync(temp,{recursive:true,force:true}));}
const interrupt=()=>{cleanup().catch(()=>console.error('D1 check cleanup failed.')).finally(()=>process.exit(130));};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
const files=readdirSync(new URL('../../migrations/gear/',import.meta.url)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
const sample={title:'Bag',description:'Sample wear',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
async function migrate(db,through=files.length){
 await db.prepare('CREATE TABLE IF NOT EXISTS gear_d1_check_migrations(name TEXT PRIMARY KEY)').run();
 for(const file of files.slice(0,through)){
  if(await db.prepare('SELECT name FROM gear_d1_check_migrations WHERE name=?').bind(file).first())continue;
  const statements=splitSQL(readFileSync(new URL('../../migrations/gear/'+file,import.meta.url),'utf8')).map(sql=>db.prepare(sql));
  await db.batch([...statements,db.prepare('INSERT INTO gear_d1_check_migrations VALUES(?)').bind(file)]);
 }
}
async function publish(db,patch={},now=100){const {id}=await createDraft(db,{...sample,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
async function publishBeforeAdultMigration(db,now=100){
 const id=crypto.randomUUID(),sellerId=crypto.randomUUID();
 await db.batch([
  db.prepare('INSERT INTO gear_sellers(id,email,created_at) VALUES(?,?,?)').bind(sellerId,sample.email,now),
  db.prepare(`INSERT INTO gear_listings
   (id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,created_at,duplicate_key)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,sellerId,sample.sellerName,sample.title,sample.description,sample.category,sample.size,sample.fit,sample.condition,sample.city,sample.type,sample.priceCents,'','',now,'upgrade-key'),
  db.prepare('INSERT INTO gear_listing_clubs(listing_id,club) VALUES(?,?)').bind(id,sample.clubs[0]),
 ]);
 const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;
}
async function login(db,email=sample.email,now=200){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
async function data(db){const tables=['gear_sellers','gear_listings','gear_listing_clubs','gear_verification_tokens','gear_management_sessions','gear_management_links','gear_email_changes','gear_photos','gear_reports','gear_removals','gear_moderation_history','gear_deletions','gear_deletion_ledger'];return JSON.stringify(await Promise.all(tables.map(async t=>(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results)));}
try{
 assert.equal(files.length,9,'Update migration coverage when adding a migration.');
 const runtimeOptions={modules:true,script:'export default {fetch(){return new Response(null,{status:404})}}',compatibilityDate:'2026-07-01',host:'127.0.0.1',d1Databases:['DB','UPGRADE','QUOTA'],d1Persist:temp};
 mf=new Miniflare(runtimeOptions);
 const db=await mf.getD1Database('DB');await migrate(db);await migrate(db);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_d1_check_migrations').first()).n,files.length);
 const probe=await db.prepare('UPDATE gear_sellers SET verified_at=1 WHERE id=? RETURNING id').bind('missing').run();
 assert.equal(probe.meta.changes,0);assert.deepEqual(probe.results,[]);
 await assert.rejects(db.batch([db.prepare('CREATE TABLE failed_migration(id TEXT PRIMARY KEY)'),db.prepare("INSERT INTO missing_migration_table VALUES('fail')")]));
 assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='failed_migration'").first(),null);
 console.log('PASS: migration batch failure rolls schema changes back.');
 console.log('PASS: all nine migrations, deletion constraints/cascade and idempotent test ledger; D1 RETURNING/meta.changes.');
 const deletionSchemaId=(await createDraft(db,{...sample,title:'Deletion schema'},140)).id;
 await assert.rejects(db.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').bind(deletionSchemaId,'unverified',141,142).run());
 await assert.rejects(db.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').bind(deletionSchemaId,'closed',141,141).run());
 await db.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').bind(deletionSchemaId,'closed',141,142).run();
 await assert.rejects(db.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,?)').bind(deletionSchemaId,141,142,141).run());
 await db.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').bind(deletionSchemaId,141,142).run();
 await db.prepare('DELETE FROM gear_listings WHERE id=?').bind(deletionSchemaId).run();
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_deletions WHERE listing_id=?').bind(deletionSchemaId).first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_deletion_ledger WHERE listing_id=?').bind(deletionSchemaId).first()).n,1);
 const lifecycleId=await publish(db,{title:'Seller lifecycle'},143),lifecycleAccess=await login(db,sample.email,144);
 assert.deepEqual(await changeSellerDeletion(db,lifecycleAccess.session,lifecycleAccess.csrf,{action:'delete',id:lifecycleId},145),{ok:true});
 assert.equal((await readPublicListings(db,146)).some(row=>row.id===lifecycleId),false);
 assert.deepEqual(await changeSellerDeletion(db,lifecycleAccess.session,lifecycleAccess.csrf,{action:'recover',id:lifecycleId},147),{ok:true});
 assert.equal((await readPublicListings(db,148)).some(row=>row.id===lifecycleId),true);
 await db.prepare('DELETE FROM gear_listings WHERE id=?').bind(lifecycleId).run();
 const id=await publish(db),access=await login(db);
 assert.equal(await submitReport(db,{listingId:id,reason:'Prohibited item'},149,'00000000-0000-4000-8000-000000000149'),true);
 await db.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").bind(id).run();
 assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},150,'00000000-0000-4000-8000-000000000150'),false);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_reports WHERE listing_id=?').bind(id).first()).n,1);
 await db.prepare("UPDATE gear_listings SET status='available' WHERE id=?").bind(id).run();
 assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'remove',id:'00000000-0000-4000-8000-000000000149',reason:'Reviewed removal'},151),true);
 assert.equal((await db.prepare('SELECT status FROM gear_listings WHERE id=?').bind(id).first()).status,'removed');
 await db.batch([
  db.prepare('INSERT INTO gear_deletions VALUES(?,?,?,?)').bind(id,'removed',151,152),
  db.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').bind(id,151,152),
 ]);
 const beforeBlockedOwnerRestore=await data(db);
 assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'restore',id,reason:'Blocked by seller deletion'},153),false);
 assert.equal(await data(db),beforeBlockedOwnerRestore);
 await db.prepare('DELETE FROM gear_deletions WHERE listing_id=?').bind(id).run();
 assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'restore',id,reason:'Reviewed restoration'},154),true);
 assert.equal((await db.prepare('SELECT status FROM gear_listings WHERE id=?').bind(id).first()).status,'available');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_deletion_ledger WHERE listing_id=?').bind(id).first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_removals').first()).n,0);
 const dismissId='00000000-0000-4000-8000-000000000153';
 assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},153,dismissId),true);
 assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'dismiss',id:dismissId,reason:'Reviewed dismissal'},154),true);
 assert.equal((await db.prepare('SELECT resolution FROM gear_reports WHERE id=?').bind(dismissId).first()).resolution,'dismissed');
 assert.deepEqual((await db.prepare('SELECT action FROM gear_moderation_history ORDER BY id').all()).results.map(row=>row.action),['remove','restore','dismiss']);
 const rollbackId='00000000-0000-4000-8000-000000000155';
 assert.equal(await submitReport(db,{listingId:id,reason:'Other concern'},155,rollbackId),true);
 await db.prepare("CREATE TRIGGER fail_production_moderation BEFORE INSERT ON gear_moderation_history BEGIN SELECT RAISE(ABORT,'test moderation failure'); END").run();
 const beforeModerationFailure=await data(db);
 await assert.rejects(moderateListing(db,{actor:'owner@example.test',action:'remove',id:rollbackId,reason:'Rollback test'},156));
 assert.equal(await data(db),beforeModerationFailure);
 await db.prepare('DROP TRIGGER fail_production_moderation').run();
 assert.equal(await moderateListing(db,{actor:'owner@example.test',action:'dismiss',id:rollbackId,reason:'Reviewed after rollback'},157),true);
 await db.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,'Bag snapshot','Other concern',150).run();
 assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='gear_reports_listing'").first());
 await db.prepare(`WITH RECURSIVE sequence(value) AS (
   VALUES(1) UNION ALL SELECT value+1 FROM sequence WHERE value<100
  ) INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at)
  SELECT printf('workerd-%03d',value),?,'Bag snapshot','Other concern',150+value FROM sequence`).bind(id).run();
 const moderationResult=await readOpenModerationReports(db);
 assert.equal(moderationResult.reports.length,100);assert.equal(moderationResult.reports[0].listingId,id);assert.equal(moderationResult.truncated,true);assert.equal(JSON.stringify(moderationResult).includes(sample.email),false);
 console.log('PASS: atomic report acceptance/rejection, owner dismiss/remove/restore and audit-failure rollback, indexed moderation schema, bounded private projection and truncation signal via D1.');
 const photo=await recordHostedPhoto(db,id,'00000000-0000-4000-8000-000000000001',200);
 assert.equal(photo.position,0);assert.equal((await readHostedPhotos(db,id))[0].providerId,photo.providerId);
 assert.deepEqual(await recoverManagementSession(db,access.session,201),{csrf:access.csrf,expiresAt:access.expiresAt});
 assert.equal((await readPublicListings(db,201)).length,1);
 assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...sample,title:'Edited',clubs:['Other'],otherClub:'Test'},202),true);
 assert.deepEqual((await listManaged(db,access.session,203))[0].clubs,['Other']);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'close',204),true);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',205),true);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',206),false);
 console.log('PASS: publication, acknowledgement, photo metadata, public projection, session recovery, seller delete/recover, JSON clubs, edit and relist via D1.');
 const duplicate=await createDraft(db,{...sample,title:'Edited',clubs:['Other'],otherClub:'Test'},207);
 const token=await issueLocalVerification(db,duplicate.id,207);
 const beforeDuplicate=await data(db);assert.equal((await confirmVerification(db,token.token,208)).verified,false);assert.equal(await data(db),beforeDuplicate);
 const clash=await publish(db,{title:'Clash'},209);
 assert.equal(await editManagedListing(db,access.session,access.csrf,clash,{...sample,title:'Edited',clubs:['Other'],otherClub:'Test'},209),false);
 await db.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").bind(clash).run();
 assert.equal(await editManagedListing(db,access.session,access.csrf,clash,{...sample,title:'Edited',clubs:['Other'],otherClub:'Test'},209),true);
 assert.equal(await changeListingState(db,access.session,access.csrf,clash,'relist',209),false);
 const stale=await publish(db,{title:'Stale'},209);await db.prepare('UPDATE gear_listings SET expires_at=210 WHERE id=?').bind(stale).run();
 await db.prepare("CREATE TRIGGER fail_edit BEFORE UPDATE OF title ON gear_listings BEGIN SELECT RAISE(ABORT,'test edit failure'); END").run();
 const beforeEdit=await data(db);await assert.rejects(editManagedListing(db,access.session,access.csrf,id,{...sample,title:'Stale'},211));assert.equal(await data(db),beforeEdit);
 await db.prepare('DROP TRIGGER fail_edit').run();
 assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...sample,title:'Stale'},212),true);
 assert.equal((await db.prepare('SELECT status FROM gear_listings WHERE id=?').bind(stale).first()).status,'expired');
 console.log('PASS: D1 duplicate error mapping and batch rollback including stale cleanup.');
 const receipt=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',213);
 await db.prepare("CREATE TRIGGER fail_transfer BEFORE UPDATE OF revoked_at ON gear_management_sessions BEGIN SELECT RAISE(ABORT,'test transfer failure'); END").run();
 const beforeTransfer=await data(db);await assert.rejects(confirmEmailChange(db,receipt.token,214));assert.equal(await data(db),beforeTransfer);
 await db.prepare('DROP TRIGGER fail_transfer').run();assert.equal(await confirmEmailChange(db,receipt.token,215),true);
 assert.equal(await confirmEmailChange(db,receipt.token,216),false);assert.equal(await listManaged(db,access.session,216),null);
 const fresh=await login(db,'new@example.test',217);assert.equal((await listManaged(db,fresh.session,218)).length,3);
 const conflictId=await publish(db,{email:'conflict@example.test',title:'Stale'},219);
 const merge=await issueLocalEmailChange(db,fresh.session,fresh.csrf,'conflict@example.test',220);
 const beforeMerge=await data(db);assert.equal(await confirmEmailChange(db,merge.token,221),false);assert.equal(await data(db),beforeMerge);
 await db.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").bind(conflictId).run();
 assert.equal(await confirmEmailChange(db,merge.token,222),true);
 assert.equal(await listManaged(db,fresh.session,223),null);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_management_links').first()).n,0);
 console.log('PASS: email transfer trigger rollback, success, replay, merge conflict/retry and revocation.');
 const quota=await mf.getD1Database('QUOTA');await migrate(quota);
 for(let i=0;i<9;i++)await publish(quota,{title:'Quota '+i});
 const tokens=[];for(let i=0;i<2;i++){const draft=await createDraft(quota,{...sample,title:'Candidate '+i},200);tokens.push(await issueLocalVerification(quota,draft.id,200));}
 const competing=await Promise.all(tokens.map(t=>confirmVerification(quota,t.token,201)));
 assert.equal(competing.filter(r=>r.verified).length,1);
 assert.equal((await readPublicListings(quota,202)).length,10);
 const waiting=await quota.prepare('SELECT listing_id FROM gear_verification_tokens WHERE consumed_at IS NULL').first();
 const quotaBefore=await data(quota);
 await assert.rejects(quota.prepare('UPDATE gear_verification_tokens SET consumed_at=202 WHERE listing_id=?').bind(waiting.listing_id).run(),/Active listing limit/);
 assert.equal(await data(quota),quotaBefore);
 await publish(quota,{email:'other@example.test',title:'Other'},203);
 const other=await login(quota,'other@example.test',204);
 const overLimit=await issueLocalEmailChange(quota,other.session,other.csrf,sample.email,205);
 const transferBefore=await data(quota);
 await assert.rejects(quota.prepare('UPDATE gear_email_changes SET consumed_at=206 WHERE consumed_at IS NULL').run(),/Email change listing limit/);
 assert.equal(await data(quota),transferBefore);
 assert.equal(await confirmEmailChange(quota,overLimit.token,206),false);
 assert.equal(await data(quota),transferBefore);
 console.log('PASS: competing D1 confirmations preserve the ten-active limit.');
 const upgrade=await mf.getD1Database('UPGRADE');await migrate(upgrade,6);
 const oldId=await publishBeforeAdultMigration(upgrade),oldAccess=await login(upgrade);const oldData=await dataWithoutProductionFoundation(upgrade);
 await migrate(upgrade);assert.equal(await dataWithoutProductionFoundation(upgrade),oldData);
 const acknowledgement=await upgrade.prepare('SELECT adult_acknowledged_at,disclosure_version FROM gear_listings WHERE id=?').bind(oldId).first();
 assert.equal(acknowledgement.adult_acknowledged_at,null);assert.equal(acknowledgement.disclosure_version,null);
 assert.equal((await listManaged(upgrade,oldAccess.session,201))[0].id,oldId);
 const transfer=await issueLocalEmailChange(upgrade,oldAccess.session,oldAccess.csrf,'upgrade@example.test',202);assert.equal(await confirmEmailChange(upgrade,transfer.token,203),true);
 console.log('PASS: populated migration-6 database upgrades through 9 with legacy acknowledgement and listing/session data preserved.');
 const persisted=await data(upgrade);
 await mf.dispose();mf=new Miniflare(runtimeOptions);
 const reopened=await mf.getD1Database('UPGRADE');await migrate(reopened);assert.equal(await data(reopened),persisted);
 console.log('PASS: persisted D1 data and applied migrations survive a workerd restart.');
 console.log('Runtime:',JSON.stringify({wrangler:require(modulePath+'/package.json').version,miniflare:wranglerRequire('miniflare/package.json').version,workerd:wranglerRequire('workerd/package.json').version}));
}finally{try{await cleanup();}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
async function dataWithoutProductionFoundation(db){
 const listingColumns='id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,status,verified_at,expires_at,created_at,duplicate_key,management_clubs';
 const queries=['SELECT * FROM gear_sellers ORDER BY rowid',`SELECT ${listingColumns} FROM gear_listings ORDER BY rowid`,'SELECT * FROM gear_listing_clubs ORDER BY rowid','SELECT * FROM gear_management_sessions ORDER BY rowid','SELECT * FROM gear_email_changes ORDER BY rowid'];
 return JSON.stringify(await Promise.all(queries.map(async sql=>(await db.prepare(sql).all()).results)));
}
