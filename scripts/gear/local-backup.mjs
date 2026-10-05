// Local sample SQLite snapshots. Never overwrite the source or an existing file.
import {DatabaseSync,backup} from 'node:sqlite';
import {openSync,closeSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {safeDatabasePath} from './local-path.mjs';
import {initializeModeration} from './local-moderation.mjs';
import {initializeLifecycle,purgeListing,cleanup,RECOVERY_MS,DRAFT_MS,HISTORY_MS} from './local-lifecycle.mjs';
function source(path){const sqlite=new DatabaseSync(safeDatabasePath(path),{readOnly:true});try{if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_migrations'").get())throw new Error('Not a Gear database.');check(sqlite);return sqlite;}catch(e){sqlite.close();throw e;}}
function check(sqlite){if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||sqlite.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database integrity check failed.');}
function clearCredentials(sqlite){
 for(const table of ['gear_email_changes','gear_listing_management_links','gear_management_links','gear_management_sessions','gear_verification_tokens'])if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))sqlite.exec('DELETE FROM '+table);
}
async function copy(from,to,after){const target=safeDatabasePath(to),input=source(from);let created=false,out;
 try{closeSync(openSync(target,'wx',0o600));created=true;await backup(input,target);out=new DatabaseSync(target);out.exec('PRAGMA foreign_keys=ON');if(after)after({sqlite:out});check(out);return {ok:true};}
 catch(e){if(out){out.close();out=null;}if(created)rmSync(target,{force:true});throw e;}finally{out?.close();input.close();}
}
export const createBackup=(from,to,now=Date.now())=>copy(from,to,db=>{
 if(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_snapshot'").get())throw new Error('Do not re-backup snapshots to extend their retention.');
 cleanup(db,{apply:true,now});
 // Credentials have no restore value; do not retain them in snapshots.
 clearCredentials(db.sqlite);
 const deadlines=[db.sqlite.prepare('SELECT min(purge_at) AS n FROM gear_local_deletions').get().n,
  db.sqlite.prepare("SELECT min(created_at)+? AS n FROM gear_listings WHERE status='unverified' AND verified_at IS NULL").get(DRAFT_MS).n];
 for(const table of ['gear_local_reports','gear_local_moderation_history'])if(db.sqlite.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))deadlines.push(db.sqlite.prepare('SELECT min(created_at)+? AS n FROM '+table).get(HISTORY_MS).n);
 deadlines.push(db.sqlite.prepare('SELECT min(purged_at)+? AS n FROM gear_local_deletion_ledger WHERE purged_at IS NOT NULL').get(RECOVERY_MS).n);
 if(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_removals'").get())deadlines.push(db.sqlite.prepare('SELECT min(removed_at)+? AS n FROM gear_local_removals WHERE removed_at>?').get(HISTORY_MS,now-HISTORY_MS).n);
 const earliest=Math.min(...deadlines.filter(n=>n!==null));
 db.sqlite.exec('CREATE TABLE gear_local_snapshot(created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)');db.sqlite.prepare('INSERT INTO gear_local_snapshot VALUES(?,?)').run(now,Math.min(now+RECOVERY_MS,earliest??Infinity));
});
export function pruneBackups(directory,{apply=false,now=Date.now()}={}){
 safeDatabasePath(join(directory,'snapshot-path-check'));let expired=0;
 for(const name of readdirSync(directory)){
  let path,db,due=false;
  try{path=safeDatabasePath(join(directory,name));db=source(path);due=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_snapshot'").get()&&db.prepare('SELECT expires_at FROM gear_local_snapshot').get()?.expires_at<=now);}catch{continue;}finally{db?.close();}
  if(due){expired++;if(apply)rmSync(path);}
 }
 return {expiredSnapshots:expired,applied:apply};
}
export async function restoreBackup(from,to,currentPath,now=Date.now()){
 // Mandatory current ledger prevents an old snapshot bypassing later deletions.
 const current=source(currentPath);let ledger,removals;
 try{if(current.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_snapshot'").get())throw new Error('Supply the current working database, not a snapshot, for reconciliation.');removals=current.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_removals'").get()?current.prepare('SELECT * FROM gear_local_removals').all():[];ledger=current.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_deletion_ledger'").get()?current.prepare('SELECT * FROM gear_local_deletion_ledger').all():[];}finally{current.close();}
 return copy(from,to,db=>{
  if(!db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_snapshot'").get())throw new Error('Not a generated Gear snapshot.');
  const metadata=db.sqlite.prepare('SELECT * FROM gear_local_snapshot').get(),created=metadata?.created_at;
  if(!Number.isSafeInteger(created)||!Number.isSafeInteger(metadata?.expires_at)||created>now||created<=now-RECOVERY_MS||metadata.expires_at<=now)throw new Error('Snapshot is outside its 30-day retention window.');
  db.sqlite.exec('DROP TABLE gear_local_snapshot');
  initializeLifecycle(db);initializeModeration(db);db.sqlite.exec('BEGIN IMMEDIATE');try{
   for(const currentRemoval of removals){
    const removal={...currentRemoval,reason:currentRemoval.removed_at<=now-HISTORY_MS?'Removal remains in effect; original reason expired.':currentRemoval.reason};
    const row=db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(removal.listing_id);if(!row)continue;
    db.sqlite.prepare('INSERT INTO gear_local_removals VALUES(?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET previous_status=excluded.previous_status,removed_at=excluded.removed_at,reason=excluded.reason').run(removal.listing_id,removal.previous_status,removal.removed_at,removal.reason);
    db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(removal.listing_id);
    db.sqlite.prepare('INSERT INTO gear_local_moderation_history(actor,action,listing_id,reason,before_status,after_status,created_at) VALUES(?,?,?,?,?,?,?)').run('local-restore','preserve-removal',removal.listing_id,'Removal preserved from current database during restore.',row.status,'removed',now);
   }
   for(const d of ledger){
    db.sqlite.prepare('INSERT INTO gear_local_deletion_ledger VALUES(?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET deleted_at=excluded.deleted_at,purge_at=excluded.purge_at,purged_at=excluded.purged_at').run(d.listing_id,d.deleted_at,d.purge_at,d.purged_at);
    const row=db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(d.listing_id);
    if(row){db.sqlite.prepare('INSERT INTO gear_local_deletions VALUES(?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET deleted_at=excluded.deleted_at,purge_at=excluded.purge_at').run(d.listing_id,row.status,d.deleted_at,d.purge_at);db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(d.listing_id);}
   }
   for(const d of db.sqlite.prepare('SELECT * FROM gear_local_deletion_ledger WHERE purged_at IS NOT NULL OR purge_at<=?').all(now))purgeListing(db,d.listing_id,now);
   // No restored cookie, recovery link or pending transfer may regain access.
   clearCredentials(db.sqlite);
   db.sqlite.exec('COMMIT');
  }catch(e){db.sqlite.exec('ROLLBACK');throw e;}
  cleanup(db,{apply:true,now});
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,from,to,current]=process.argv.slice(2);
 if(action==='prune'){if(!from||to&&to!=='--apply')throw new Error('Usage: local-backup.mjs prune SNAPSHOT_DIRECTORY [--apply]');console.log(JSON.stringify(pruneBackups(from,{apply:to==='--apply'})));}
 else {
 if(!from||!to||!['backup','restore'].includes(action)||(action==='restore'&&!current))throw new Error('Usage: local-backup.mjs backup SOURCE NEW_SNAPSHOT | restore SNAPSHOT NEW_DATABASE CURRENT_DATABASE. Stop the local server first.');
 if(action==='backup')await createBackup(from,to);else await restoreBackup(from,to,current);
 console.log('Local snapshot operation complete; integrity checked. No existing file overwritten.');
 }
}
