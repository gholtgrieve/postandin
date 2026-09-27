// Optional local D1/workerd integration check. No remote resources or repo dependencies.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDraft,readPublicListings} from '../../lib/gear-storage.mjs';
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
async function login(db,email=sample.email,now=200){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
async function data(db){const tables=['gear_sellers','gear_listings','gear_listing_clubs','gear_verification_tokens','gear_management_sessions','gear_management_links','gear_email_changes'];return JSON.stringify(await Promise.all(tables.map(async t=>(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results)));}
try{
 assert.equal(files.length,6,'Update migration coverage when adding a migration.');
 const runtimeOptions={modules:true,script:'export default {fetch(){return new Response(null,{status:404})}}',compatibilityDate:'2026-07-01',host:'127.0.0.1',d1Databases:['DB','UPGRADE','QUOTA'],d1Persist:temp};
 mf=new Miniflare(runtimeOptions);
 const db=await mf.getD1Database('DB');await migrate(db);await migrate(db);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM gear_d1_check_migrations').first()).n,files.length);
 const probe=await db.prepare('UPDATE gear_sellers SET verified_at=1 WHERE id=? RETURNING id').bind('missing').run();
 assert.equal(probe.meta.changes,0);assert.deepEqual(probe.results,[]);
 await assert.rejects(db.batch([db.prepare('CREATE TABLE failed_migration(id TEXT PRIMARY KEY)'),db.prepare("INSERT INTO missing_migration_table VALUES('fail')")]));
 assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='failed_migration'").first(),null);
 console.log('PASS: migration batch failure rolls schema changes back.');
 console.log('PASS: all six migrations and idempotent test ledger; D1 RETURNING/meta.changes.');
 const id=await publish(db),access=await login(db);
 assert.deepEqual(await recoverManagementSession(db,access.session,201),{csrf:access.csrf,expiresAt:access.expiresAt});
 assert.equal((await readPublicListings(db,201)).length,1);
 assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...sample,title:'Edited',clubs:['Other'],otherClub:'Test'},202),true);
 assert.deepEqual((await listManaged(db,access.session,203))[0].clubs,['Other']);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'close',204),true);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',205),true);
 assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',206),false);
 console.log('PASS: publication, public projection, session recovery, JSON clubs, edit and relist via D1.');
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
 const upgrade=await mf.getD1Database('UPGRADE');await migrate(upgrade,5);
 const oldId=await publish(upgrade),oldAccess=await login(upgrade);const oldData=await dataWithoutEmailChange(upgrade);
 await migrate(upgrade);assert.equal(await dataWithoutEmailChange(upgrade),oldData);
 assert.equal((await listManaged(upgrade,oldAccess.session,201))[0].id,oldId);
 const transfer=await issueLocalEmailChange(upgrade,oldAccess.session,oldAccess.csrf,'upgrade@example.test',202);assert.equal(await confirmEmailChange(upgrade,transfer.token,203),true);
 console.log('PASS: populated migration-5 database upgrades to 6 with listing/session data preserved.');
 const persisted=await data(upgrade);
 await mf.dispose();mf=new Miniflare(runtimeOptions);
 const reopened=await mf.getD1Database('UPGRADE');await migrate(reopened);assert.equal(await data(reopened),persisted);
 console.log('PASS: persisted D1 data and applied migrations survive a workerd restart.');
 console.log('Runtime:',JSON.stringify({wrangler:require(modulePath+'/package.json').version,miniflare:wranglerRequire('miniflare/package.json').version,workerd:wranglerRequire('workerd/package.json').version}));
}finally{try{await cleanup();}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
async function dataWithoutEmailChange(db){return JSON.stringify(await Promise.all(['gear_sellers','gear_listings','gear_listing_clubs','gear_management_sessions'].map(async t=>(await db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()).results)));}
