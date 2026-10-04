import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {createDraft,readPublicListings} from '../lib/gear-storage.mjs';
import {createLeanGearBackup,restoreLeanGearBackup,validateLeanGearBackup,GEAR_LEAN_BACKUP_RETENTION_MS,GEAR_LEAN_REMOVAL_REASON} from '../lib/gear-lean-backup.mjs';
import {SELLER_RECOVERY_MS} from '../lib/gear-seller-deletion.mjs';
import {ageEncrypt,BACKUP_SUCCESS_MESSAGE,exportDurationOutput,runLeanCloudBackup,safeFailure,successOutput} from '../scripts/gear/lean-cloud-backup.mjs';
import {readLeanBackupFile,restoreLeanBackupFile,writeLeanRestoreSql} from '../scripts/gear/lean-backup.mjs';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const sample={title:'Backup bag',description:'Used for backup testing.',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:['Kent Valley']};
const migrationNames=['drafts','verification','duplicates','publication_duplicates','management','email_change','production_foundation','moderation','seller_deletions','maintenance','photo_quarantines','photo_reconciliation','photo_upload_limits','verification_delivery_limits','contact_delivery','unified_removal','draft_photo_access','management_session_retention','management_recovery_limits'];
const migrationsSql=()=>migrationNames.map((name,index)=>readFileSync(new URL(`../migrations/gear/${String(index+1).padStart(4,'0')}_${name}.sql`,import.meta.url),'utf8')).join('\n');

async function published(db,patch={},now=Date.now()){
  const value={...sample,...patch},{id}=await createDraft(db,value,now);
  db.sqlite.prepare('UPDATE gear_sellers SET verified_at=? WHERE email=?').run(now,value.email);
  db.sqlite.prepare("UPDATE gear_listings SET status='available',verified_at=?,expires_at=? WHERE id=?").run(now,now+30*86_400_000,id);
  return id;
}

test('lean backup keeps recoverable records but excludes photos, drafts, credentials, contact and report history',async()=>{
  const db=openLocalDatabase(),now=Date.now();
  try{
    const live=await published(db,{},now),removed=await published(db,{title:'Owner removed',email:'removed@example.test'},now+1),deleted=await published(db,{title:'Seller deleted',email:'deleted@example.test'},now+2);
    await createDraft(db,{...sample,title:'Private draft',email:'draft@example.test'},now+3);
    const providerId='private-provider-id-that-must-not-leave-cloudflare';
    db.sqlite.prepare('INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),live,providerId,0,now);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(removed);
    db.sqlite.prepare("INSERT INTO gear_removals VALUES(?,'available',?,'private owner reason')").run(removed,now);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(deleted);
    db.sqlite.prepare("INSERT INTO gear_deletions VALUES(?,'available',?,?)").run(deleted,now,now+30*86_400_000);
    db.sqlite.prepare('INSERT INTO gear_deletion_ledger VALUES(?,?,?,NULL)').run(deleted,now,now+30*86_400_000);
    db.sqlite.prepare('INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),live,'Private title','Other concern',now);
    db.sqlite.prepare('INSERT INTO gear_moderation_history(actor,action,listing_id,reason,before_status,after_status,created_at) VALUES(?,?,?,?,?,?,?)').run('private-owner@example.test','remove',live,'private history reason','available','removed',now);
    db.sqlite.prepare('INSERT INTO gear_management_sessions VALUES(?,?,?,?,?,NULL)').run('session-secret',db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(live).seller_id,'csrf-secret',now,now+1000);
    const backup=createLeanGearBackup(db.sqlite,{now,bookmark:'bookmark-1',backupId:'00000000-0000-4000-8000-000000000001'}),serialized=JSON.stringify(backup);
    assert.equal(backup.expiresAt,now+GEAR_LEAN_BACKUP_RETENTION_MS);
    assert.deepEqual(backup.tables.listings.map(row=>row.id),[live,removed].sort());
    assert.equal(backup.tables.removals[0].reason,GEAR_LEAN_REMOVAL_REASON);
    assert.deepEqual(backup.deletionEvidence,[{listingId:deleted,deletedAt:now,purgeAt:now+30*86_400_000}]);
    for(const secret of [providerId,'Private draft','draft@example.test','deleted@example.test','session-secret','csrf-secret','Private title','private-owner@example.test','private history reason','private owner reason'])assert.equal(serialized.includes(secret),false,secret);
    assert.doesNotThrow(()=>validateLeanGearBackup(backup,{now}));
  }finally{db.close();}
});

test('lean backup validation rejects expiry, shape changes and broken relationships',async()=>{
  const db=openLocalDatabase(),now=Date.now();
  try{
    await published(db,{},now);const backup=createLeanGearBackup(db.sqlite,{now,bookmark:'bookmark-2',backupId:'00000000-0000-4000-8000-000000000002'});
    assert.throws(()=>validateLeanGearBackup(backup,{now:backup.expiresAt}),/expired/);
    assert.throws(()=>validateLeanGearBackup({...backup,extra:true}),/Invalid/);
    const orphan=structuredClone(backup);orphan.tables.sellers=[];assert.throws(()=>validateLeanGearBackup(orphan),/relationships/);
    const draft=structuredClone(backup);draft.tables.listings[0].status='unverified';assert.throws(()=>validateLeanGearBackup(draft),/Invalid/);
  }finally{db.close();}
});

test('lean backup retention cannot outlive seller deletion evidence',()=>{
  assert.ok(GEAR_LEAN_BACKUP_RETENTION_MS<=SELLER_RECOVERY_MS);
});

test('lean restore is photo-free, credential-free and reconciles newer deletion evidence',async()=>{
  const source=openLocalDatabase(),target=openLocalDatabase(),now=Date.now();
  try{
    const keep=await published(source,{},now),blocked=await published(source,{title:'Later deleted',email:'later@example.test'},now+1);
    source.sqlite.prepare('INSERT INTO gear_photos(id,listing_id,provider_id,position,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),keep,'not-backed-up',0,now);
    const backup=createLeanGearBackup(source.sqlite,{now,bookmark:'bookmark-3',backupId:'00000000-0000-4000-8000-000000000003'}),evidence={listingId:blocked,deletedAt:now+2,purgeAt:now+GEAR_LEAN_BACKUP_RETENTION_MS};
    const result=restoreLeanGearBackup(target.sqlite,backup,{now:now+3,newerDeletionEvidence:[evidence]});
    assert.deepEqual(result,{listings:1,sellers:1,photos:0,blocked:1});
    assert.deepEqual((await readPublicListings(target)).map(row=>row.id),[keep]);
    for(const table of ['gear_photos','gear_verification_tokens','gear_management_links','gear_management_sessions','gear_email_changes','gear_contact_attempts','gear_contact_messages','gear_reports','gear_moderation_history'])assert.equal(target.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
    assert.equal(target.sqlite.prepare('SELECT purged_at FROM gear_deletion_ledger WHERE listing_id=?').get(blocked).purged_at,evidence.purgeAt);
    assert.throws(()=>restoreLeanGearBackup(target.sqlite,backup,{now:now+4}),/not empty/);
  }finally{source.close();target.close();}
});

test('lean restore file refuses overwrite and creates a private restorable database',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'gear-lean-restore-')),file=join(directory,'backup.json'),target=join(directory,'restored.sqlite'),sqlFile=join(directory,'restore.sql'),source=openLocalDatabase(),now=Date.now();let restored,sqlTarget;
  try{
    const id=await published(source,{},now),backup=createLeanGearBackup(source.sqlite,{now,bookmark:'bookmark-file',backupId:'00000000-0000-4000-8000-000000000004'});writeFileSync(file,JSON.stringify(backup),{mode:0o600});
    assert.equal(readLeanBackupFile(file,{now}).backupId,backup.backupId);assert.deepEqual(restoreLeanBackupFile(file,target,{now:now+1}),{listings:1,sellers:1,photos:0,blocked:0});assert.equal(statSync(target).mode&0o777,0o600);
    restored=openLocalDatabase(target);assert.deepEqual((await readPublicListings(restored)).map(row=>row.id),[id]);restored.close();restored=null;
    assert.throws(()=>restoreLeanBackupFile(file,target,{now:now+2}),/new file/);
    assert.ok(writeLeanRestoreSql(file,sqlFile,{now:now+2}).bytes>0);assert.equal(statSync(sqlFile).mode&0o777,0o600);sqlTarget=new DatabaseSync(':memory:');sqlTarget.exec(migrationsSql());sqlTarget.exec(readFileSync(sqlFile,'utf8'));
    const restoredRow=sqlTarget.prepare('SELECT id,duplicate_key FROM gear_listings').get();assert.equal(restoredRow.id,id);assert.equal(typeof restoredRow.duplicate_key,'string');assert.ok(restoredRow.duplicate_key.length>0);
  }finally{sqlTarget?.close();restored?.close();source.close();rmSync(directory,{recursive:true,force:true});}
});

test('lean backup CLIs run through symlink paths containing spaces',()=>{
  const directory=mkdtempSync(join(tmpdir(),'gear lean cli-')),cwd=fileURLToPath(new URL('..',import.meta.url));
  try{
    const script=join(directory,'lean backup.mjs'),cloudScript=join(directory,'lean cloud backup.mjs');
    symlinkSync(fileURLToPath(new URL('../scripts/gear/lean-backup.mjs',import.meta.url)),script);symlinkSync(fileURLToPath(new URL('../scripts/gear/lean-cloud-backup.mjs',import.meta.url)),cloudScript);
    const result=spawnSync(process.execPath,[script],{cwd,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/Usage: lean-backup\.mjs/);
    const cloudResult=spawnSync(process.execPath,[cloudScript],{cwd,encoding:'utf8',env:{}});assert.notEqual(cloudResult.status,0);assert.equal(cloudResult.stderr,'Gear backup failed: Backup configuration is invalid.\n');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('lean cloud CLI diagnostics are fixed and safe',()=>{
  assert.equal(BACKUP_SUCCESS_MESSAGE,'Gear backup completed and verified.');
  const output=`${exportDurationOutput(1234)}\n${successOutput({backupId:'private-id',fileName:'private-name',bytes:999})}`;
  assert.equal(output,'D1 export completed in 1.23 s.\nGear backup completed and verified.');
  for(const privateValue of ['private-id','private-name','999'])assert.equal(output.includes(privateValue),false);
  assert.equal(safeFailure(new Error('Lean backup is too large.')),'Lean backup is too large.');
  assert.equal(safeFailure(new Error('Invalid Gear lean backup relationships.')),'Invalid Gear lean backup relationships.');
  assert.equal(safeFailure(new Error('Gear lean backup has expired.')),'Gear lean backup has expired.');
  assert.equal(safeFailure(new Error('Gear backup retention cannot exceed seller-deletion evidence retention.')),'Gear backup retention cannot exceed seller-deletion evidence retention.');
  assert.equal(safeFailure(new TypeError('Invalid Gear backup input.')),'Invalid Gear backup input.');
  assert.equal(safeFailure(new Error('private-token-should-never-print')),'Unexpected backup failure.');
});

test('age encryption reports a fixed error when the binary cannot start',async()=>{
  const spawnImpl=()=>{const child=new EventEmitter();child.stderr=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('private spawn detail')));return child;};
  await assert.rejects(ageEncrypt('input','output',cloudEnv.GEAR_BACKUP_AGE_RECIPIENT,{spawnImpl}),/Unable to start age encryption/);
});

test('Gear backup workflow remains manual-capable, nightly, pinned and production-environment restricted',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/gear-records-backup.yml',import.meta.url),'utf8');
  const runbook=readFileSync(new URL('../instructions/gear-launch-runbook.md',import.meta.url),'utf8');
  const active=workflow.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
  assert.equal(active.match(/^on:\n([\s\S]*?)\n\npermissions:/m)?.[1].trim(),'workflow_dispatch:\n  schedule:\n    - cron: "17 8 * * *"');
  assert.match(runbook,/first 08:17 UTC \(`17 8 \* \* \*`\)\s+occurrence/);
  assert.match(active,/^permissions:\n  contents: read$/m);
  assert.match(active,/^          persist-credentials: false$/m);
  assert.match(workflow,/^    environment: gear-backup$/m);
  assert.match(workflow,/^  group: gear-records-backup$/m);
  assert.match(workflow,/actions\/checkout@[a-f0-9]{40} # v7\.0\.1/);
  assert.match(workflow,/actions\/setup-node@[a-f0-9]{40} # v7\.0\.0/);
  assert.match(active,/^    runs-on: ubuntu-24\.04$/m);
  assert.match(active,/age=1\.1\.1-1ubuntu0\.24\.04\.3/);
  assert.equal([...active.matchAll(/secrets\.(GEAR_BACKUP_[A-Z0-9_]+)/g)].map(match=>match[1]).sort().join(','),Object.keys(cloudEnv).sort().join(','));
  assert.match(active,/^        run: node scripts\/gear\/lean-cloud-backup\.mjs$/m);
});

test('public Gear privacy copy discloses the bounded off-site records backup',()=>{
  const html=readFileSync(new URL('../gear/index.html',import.meta.url),'utf8');
  const source=readFileSync(new URL('../gear/gear.mjs',import.meta.url),'utf8');
  const disclosure="Nightly, GitHub Actions reads Gear listing records, keeps published listings (including closed, expired, or moderator-removed ones; listings you remove yourself are left out of later backups) and each retained seller's account email, encrypts them, and copies them to a private off-site Backblaze B2 backup retained for about 30 days. Photos, unpublished drafts, and contact messages are not kept in that backup.";
  const rules=html.match(/<details class="pi-recovery" id="pi-gear-rules">([\s\S]*?)<\/details>/)?.[1]||'';
  assert.match(rules,new RegExp(`<p id="pi-backup-disclosure" hidden>${disclosure.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}<\\/p>[\\s\\S]*?<p id="pi-local-rules" hidden>`));
  const connectedStart=source.indexOf('\nif(connectedMode){\n managed.length=0;');
  const recoveryStart=source.indexOf(" $('#pi-recovery-send').textContent=",connectedStart);
  const connectedSetup=source.slice(connectedStart,recoveryStart);
  const localStart=connectedSetup.indexOf(' if(localMode){');
  const productionStart=connectedSetup.indexOf('\n else{',localStart);
  assert.ok(connectedStart>=0&&recoveryStart>connectedStart&&localStart>=0&&productionStart>localStart);
  const localBranch=connectedSetup.slice(localStart,productionStart);
  const productionBranch=connectedSetup.slice(productionStart);
  assert.equal((source.match(/\$\('#pi-backup-disclosure'\)\.hidden=false;/g)||[]).length,1);
  assert.doesNotMatch(localBranch,/pi-backup-disclosure/);
  assert.match(productionBranch,/\$\('#pi-backup-disclosure'\)\.hidden=false;[\s\S]*?\$\('#pi-local-rules'\)\.hidden=true;/);
});

const cloudEnv={
  GEAR_BACKUP_CF_ACCOUNT_ID:'0123456789abcdef0123456789abcdef',
  GEAR_BACKUP_D1_DATABASE_ID:'00000000-0000-4000-8000-000000000099',
  GEAR_BACKUP_CF_API_TOKEN:'cloudflare-test-token',
  GEAR_BACKUP_B2_KEY_ID:'b2-test-id',
  GEAR_BACKUP_B2_APP_KEY:'b2-test-key',
  GEAR_BACKUP_B2_BUCKET_ID:'b2-test-bucket',
  GEAR_BACKUP_AGE_RECIPIENT:'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
};
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});

function exportedSql(now,id){
  return `${migrationsSql()}\nINSERT INTO gear_sellers VALUES('00000000-0000-4000-8000-000000000090','backup@example.test',${now},${now});
INSERT INTO gear_listings(id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,status,verified_at,expires_at,created_at,adult_acknowledged_at,disclosure_version,duplicate_key,management_clubs)
VALUES('${id}','00000000-0000-4000-8000-000000000090','Seller','Cloud backup','Used','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,'','','available',${now},${now+GEAR_LEAN_BACKUP_RETENTION_MS},${now},${now},'gear-adult-v1','key',NULL);`;
}

function childFirstExportedSql(now,id){
  return `${migrationsSql()}\n
INSERT INTO gear_listings(id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,price_cents,trade,other_club,status,verified_at,expires_at,created_at,adult_acknowledged_at,disclosure_version,duplicate_key,management_clubs)
VALUES('${id}','00000000-0000-4000-8000-000000000090','Seller','Cloud backup','Used','Bags & accessories','Junior','Junior','Used — good','Seattle','sale',4000,'','','available',${now},${now+GEAR_LEAN_BACKUP_RETENTION_MS},${now},${now},'gear-adult-v1','key',NULL);
INSERT INTO gear_sellers VALUES('00000000-0000-4000-8000-000000000090','backup@example.test',${now},${now});`;
}

function cloudFetch({sql,evidence=[],capabilities=['writeFiles','readFiles'],pollOnce=false,readBackMismatch=false}){
  let uploaded,exportCalls=0;const calls=[];
  const fetchImpl=async(url,options={})=>{
    const target=String(url);calls.push(target);
    if(target.endsWith('/export')){
      exportCalls++;assert.deepEqual(JSON.parse(options.body),{output_format:'polling',dump_options:{tables:['gear_sellers','gear_listings','gear_listing_clubs','gear_removals','gear_deletions','gear_deletion_ledger']},...(exportCalls>1?{current_bookmark:'bookmark-cloud'}:{})});
      if(pollOnce&&exportCalls===1)return json({success:true,result:{at_bookmark:'bookmark-cloud',status:'active'}});
      return json({success:true,result:{at_bookmark:'bookmark-cloud',status:'complete',result:{signed_url:'https://download.test/export.sql'}}});
    }
    if(target==='https://download.test/export.sql')return new Response(sql,{status:200});
    if(target.endsWith('/query'))return json({success:true,result:[{results:evidence}]});
    if(target.includes('b2_authorize_account'))return json({authorizationToken:'account-token',apiInfo:{storageApi:{apiUrl:'https://api.test',downloadUrl:'https://download-b2.test',allowed:{capabilities,namePrefix:'gear/',buckets:[{id:cloudEnv.GEAR_BACKUP_B2_BUCKET_ID}]}}}});
    if(target.includes('b2_get_upload_url'))return json({uploadUrl:'https://upload.test/file',authorizationToken:'upload-token'});
    if(target==='https://upload.test/file'){uploaded=Buffer.from(options.body);return json({fileId:'file-id',contentLength:uploaded.length,contentSha1:options.headers['X-Bz-Content-Sha1']});}
    if(target.includes('b2_download_file_by_id'))return new Response(readBackMismatch?Buffer.from('wrong encrypted bytes'):uploaded,{status:200});
    throw new Error(`Unexpected test request: ${target}`);
  };
  return {fetchImpl,calls};
}

test('lean cloud runner exports, reconciles, encrypts, uploads and reads back without real providers',async()=>{
  const now=2_000_000_000_000,id='00000000-0000-4000-8000-000000000091',later={listingId:id,deletedAt:now+1,purgeAt:now+GEAR_LEAN_BACKUP_RETENTION_MS},mock=cloudFetch({sql:exportedSql(now,id),evidence:[later],pollOnce:true}),waits=[];let plaintext;
  const ticks=[100,235],result=await runLeanCloudBackup({env:cloudEnv,fetchImpl:mock.fetchImpl,wait:async ms=>waits.push(ms),now:()=>now,clock:()=>ticks.shift(),uuid:()=> '00000000-0000-4000-8000-000000000092',encrypt:async(input,output)=>{plaintext=JSON.parse(readFileSync(input,'utf8'));writeFileSync(output,Buffer.from('synthetic age ciphertext'),{mode:0o600,flag:'wx'});}});
  assert.equal(plaintext.tables.listings.length,0);assert.deepEqual(plaintext.deletionEvidence,[later]);assert.equal(JSON.stringify(plaintext).includes('backup@example.test'),false);
  assert.equal(result.fileName,'gear/records-2033-05-18-00000000-0000-4000-8000-000000000092.json.age');assert.equal(result.bytes,24);assert.equal(result.scope,'records-only-no-photos-no-drafts-no-credentials-no-contact-no-report-history');
  assert.equal(result.d1ExportMs,135);
  assert.deepEqual(waits,[5000]);
  assert.equal(mock.calls.some(url=>url.includes('b2_download_file_by_id')),true);
});

test('lean cloud runner accepts a D1 export whose child rows precede parent rows',async()=>{
  const now=2_000_000_000_000,id='00000000-0000-4000-8000-000000000097',mock=cloudFetch({sql:childFirstExportedSql(now,id)});let plaintext;
  await runLeanCloudBackup({env:cloudEnv,fetchImpl:mock.fetchImpl,now:()=>now,uuid:()=> '00000000-0000-4000-8000-000000000098',encrypt:async(input,output)=>{plaintext=JSON.parse(readFileSync(input,'utf8'));writeFileSync(output,'encrypted',{mode:0o600,flag:'wx'});}});
  assert.deepEqual(plaintext.tables.listings.map(row=>row.id),[id]);
  assert.equal(plaintext.tables.sellers.length,1);
});

test('lean cloud runner returns generic fixed errors for provider HTTP failures',async()=>{
  await assert.rejects(runLeanCloudBackup({env:cloudEnv,fetchImpl:async()=>new Response('private provider details',{status:503})}),/Backup provider request failed/);
});

test('lean cloud runner rejects missing export bookmarks and invalid export SQL with fixed diagnostics',async()=>{
  const withoutBookmark=async(url)=>String(url).endsWith('/export')?json({success:true,result:{status:'complete',result:{signed_url:'https://download.test/export.sql'}}}):new Response(exportedSql(Date.now(),'00000000-0000-4000-8000-000000000080'));
  await assert.rejects(runLeanCloudBackup({env:cloudEnv,fetchImpl:withoutBookmark}),/D1 export returned no bookmark/);
  const invalid=cloudFetch({sql:'private invalid SQL text'});
  await assert.rejects(runLeanCloudBackup({env:cloudEnv,fetchImpl:invalid.fetchImpl}),/D1 export SQL could not be loaded/);
  assert.equal(safeFailure(new Error('D1 export SQL could not be loaded.')),'D1 export SQL could not be loaded.');
});

test('lean cloud runner fails before provider work on bad config and rejects every overbroad B2 key',async()=>{
  let calls=0;await assert.rejects(runLeanCloudBackup({env:{},fetchImpl:async()=>{calls++;throw new Error('must not call');}}),/Invalid GEAR_BACKUP_CF_ACCOUNT_ID/);assert.equal(calls,0);
  const now=2_000_000_000_000,id='00000000-0000-4000-8000-000000000093';
  for(const capabilities of [['writeFiles','readFiles','deleteFiles'],['writeFiles','readFiles','listFiles']]){
    const mock=cloudFetch({sql:exportedSql(now,id),capabilities}),ticks=[100,235],measured=[];
    await assert.rejects(runLeanCloudBackup({env:cloudEnv,fetchImpl:mock.fetchImpl,now:()=>now,clock:()=>ticks.shift(),onExportMeasured:value=>measured.push(exportDurationOutput(value)),uuid:()=> '00000000-0000-4000-8000-000000000094',encrypt:async(_input,output)=>writeFileSync(output,'encrypted',{mode:0o600,flag:'wx'})}),/not safely scoped/);
    assert.deepEqual(measured,['D1 export completed in 0.14 s.']);
  }
});

test('lean cloud runner detects read-back corruption and removes temporary plaintext after failure',async()=>{
  const before=new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('postandin-gear-backup-'))),now=2_000_000_000_000,id='00000000-0000-4000-8000-000000000095',mock=cloudFetch({sql:exportedSql(now,id),readBackMismatch:true});
  await assert.rejects(runLeanCloudBackup({env:cloudEnv,fetchImpl:mock.fetchImpl,now:()=>now,uuid:()=> '00000000-0000-4000-8000-000000000096',encrypt:async(_input,output)=>writeFileSync(output,'encrypted',{mode:0o600,flag:'wx'})}),/read-back verification failed/);
  assert.deepEqual(new Set(readdirSync(tmpdir()).filter(name=>name.startsWith('postandin-gear-backup-'))),before);
});
