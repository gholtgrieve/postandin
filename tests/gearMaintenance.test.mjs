import test from 'node:test';
import assert from 'node:assert/strict';
import {startMaintenance} from '../scripts/gear/local-maintenance.mjs';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {localServer} from '../scripts/gear/local-server.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {localContact} from '../scripts/gear/local-contact.mjs';
import {localReports} from '../scripts/gear/local-reports.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
const sample={title:'Bag',description:'Sample wear',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
test('maintenance runs immediately, retries failures, resumes daily and cancels on shutdown',()=>{
 let calls=0,errors=0,next,delay,cancelled;
 const stop=startMaintenance(()=>{if(++calls===1)throw Error('private');},{schedule:(fn,ms)=>{next=fn;delay=ms;return 42;},cancel:id=>cancelled=id,onError:()=>errors++});
 assert.equal(calls,1);assert.equal(errors,1);assert.equal(delay,60000);next();assert.equal(calls,2);assert.equal(delay,86400000);stop();assert.equal(cancelled,42);next();assert.equal(calls,2);
});
test('listening local server automatically cleans abandoned sample drafts',async()=>{
 const db=openLocalDatabase();let server;
 try{await createDraft(db,sample);db.sqlite.prepare('UPDATE gear_listings SET created_at=?').run(Date.now()-3*86400000);server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,0);}
 finally{if(server)await new Promise(r=>server.close(r));db.close();}
});
test('contact and memory reports expire at their exact retention boundaries',async()=>{
 const db=openLocalDatabase();try{
  const {id}=await createDraft(db,sample),token=await issueLocalVerification(db,id);await confirmVerification(db,token.token);
  const now=Date.now(),contact=localContact(db),reports=localReports(db);
  contact.send({id,name:'Buyer',email:'buyer@example.test',message:'Sample',shareEmail:true,adult:true},now);reports.submit({id,reason:'Other concern'},now);
  contact.prune(now+86400000-1);assert.equal(contact.receipts.length,1);contact.prune(now+86400000);assert.equal(contact.receipts.length,0);
  reports.prune(now+30*86400000-1);assert.equal(reports.reports.length,1);reports.prune(now+30*86400000);assert.equal(reports.reports.length,0);
 }finally{db.close();}
});
test('automatic cleanup prunes configured expired snapshots and preserves working files',async()=>{
 const {mkdtempSync,rmSync,existsSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createBackup}=await import('../scripts/gear/local-backup.mjs');
 const dir=mkdtempSync(join(tmpdir(),'gear-auto-prune-')),path=join(dir,'source.sqlite'),snapshot=join(dir,'snapshot.sqlite');const db=openLocalDatabase(path);let server;
 try{
  await createBackup(path,snapshot);const copy=openLocalDatabase(snapshot);try{copy.sqlite.prepare('UPDATE gear_local_snapshot SET expires_at=?').run(Date.now()-1);}finally{copy.close();}
  server=localServer(db,{backupDirectory:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  assert.equal(existsSync(snapshot),false);assert.equal(existsSync(path),true);
 }finally{if(server)await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});
test('invalid backup directory fails before cleanup or server startup',async()=>{
 const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'gear-invalid-backups-')),file=join(dir,'file');writeFileSync(file,'sample');const db=openLocalDatabase();
 try{
  await createDraft(db,sample);db.sqlite.prepare('UPDATE gear_listings SET created_at=?').run(Date.now()-4*86400000);
  for(const backupDirectory of [join(dir,'missing'),file,process.cwd(),''])assert.throws(()=>localServer(db,{backupDirectory}),/Invalid GEAR_BACKUP_DIRECTORY/);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings').get().n,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
