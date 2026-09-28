// Local SQLite lifecycle only. Thirty-day deletion recovery; explicit cleanup.
import {createHash} from 'node:crypto';
import {LIMITS} from '../../lib/gear-exchange.mjs';
export const RECOVERY_MS=30*86400000;
export class LifecycleError extends Error{constructor(status,message){super(message);this.status=status;}}
const hash=s=>createHash('sha256').update(s).digest('hex');
export function initializeLifecycle(db){db.sqlite.exec(`CREATE TABLE IF NOT EXISTS gear_local_deletions (
 listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id) ON DELETE CASCADE,
 previous_status TEXT NOT NULL,deleted_at INTEGER NOT NULL,purge_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS gear_local_deletion_ledger (
 listing_id TEXT PRIMARY KEY,deleted_at INTEGER NOT NULL,purge_at INTEGER NOT NULL,purged_at INTEGER);`);}
export function isDeleted(db,id){return Boolean(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='gear_local_deletions'").get()&&db.sqlite.prepare('SELECT 1 FROM gear_local_deletions WHERE listing_id=?').get(id));}
function seller(db,raw,csrf,now){
 if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))throw new LifecycleError(401,'Access unavailable.');
 const row=db.sqlite.prepare('SELECT seller_id,csrf_hash FROM gear_management_sessions WHERE session_hash=? AND created_at<=? AND expires_at>? AND revoked_at IS NULL').get(hash(raw),now,now);
 if(!row)throw new LifecycleError(401,'Access unavailable.');
 if(csrf!==undefined&&(typeof csrf!=='string'||row.csrf_hash!==hash(csrf)))throw new LifecycleError(403,'Request not allowed.');return row.seller_id;
}
export function deletedListings(db,raw,now=Date.now()){
 const owner=seller(db,raw,undefined,now);
 return db.sqlite.prepare('SELECT l.id,l.title,d.deleted_at AS deletedAt,d.purge_at AS purgeAt FROM gear_local_deletions d JOIN gear_listings l ON l.id=d.listing_id WHERE l.seller_id=? ORDER BY d.deleted_at DESC').all(owner);
}
export function changeDeletion(db,raw,csrf,input,now=Date.now()){
 const owner=seller(db,raw,csrf,now);
 if(!input||!['delete','restore'].includes(input.action)||typeof input.id!=='string')throw new LifecycleError(400,'Choose a listing and action.');
 const conflict=()=>{throw new LifecycleError(409,'This listing cannot be recovered or changed. Refresh and check its recovery deadline.');};
 db.sqlite.exec('BEGIN IMMEDIATE');try{
  const row=db.sqlite.prepare('SELECT l.*,s.verified_at AS seller_verified FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=? AND l.seller_id=? AND l.verified_at IS NOT NULL').get(input.id,owner);if(!row)throw new LifecycleError(403,'Unable to change this listing.');
  const deletion=db.sqlite.prepare('SELECT * FROM gear_local_deletions WHERE listing_id=?').get(row.id);
  if(input.action==='delete'){
   if(deletion)conflict();
   db.sqlite.prepare('INSERT INTO gear_local_deletions VALUES(?,?,?,?)').run(row.id,row.status,now,now+RECOVERY_MS);
   db.sqlite.prepare('INSERT INTO gear_local_deletion_ledger VALUES(?,?,?,NULL) ON CONFLICT(listing_id) DO UPDATE SET deleted_at=excluded.deleted_at,purge_at=excluded.purge_at,purged_at=NULL').run(row.id,now,now+RECOVERY_MS);
   db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(row.id);
  }else{
   if(!deletion||deletion.purge_at<=now||row.status!=='removed')conflict();let target=deletion.previous_status;
   // Recovery of a moderated listing leaves it removed; owner review is separate.
   if(['available','pending'].includes(target)){
    if(row.expires_at<=now)target='expired';else{
     if(row.seller_verified===null)conflict();
     const count=db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE seller_id=? AND status IN ('available','pending') AND expires_at>?").get(owner,now).n;
     const duplicate=db.sqlite.prepare("SELECT id FROM gear_listings WHERE seller_id=? AND duplicate_key=? AND status IN ('available','pending') AND expires_at>?").get(owner,row.duplicate_key,now);
     if(count>=LIMITS.activeListings||duplicate)conflict();
     db.sqlite.prepare("UPDATE gear_listings SET status='expired' WHERE seller_id=? AND duplicate_key=? AND status IN ('available','pending') AND expires_at<=?").run(owner,row.duplicate_key,now);
    }
   }
   db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(target,row.id);
   db.sqlite.prepare('DELETE FROM gear_local_deletions WHERE listing_id=?').run(row.id);
   db.sqlite.prepare('DELETE FROM gear_local_deletion_ledger WHERE listing_id=?').run(row.id);
  }
  db.sqlite.exec('COMMIT');return {ok:true};
 }catch(e){db.sqlite.exec('ROLLBACK');throw e;}
}
const has=(db,table)=>Boolean(db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
// Caller owns a transaction. Purge all listing content, including private snapshots.
export function purgeListing(db,id,now){
 for(const table of ['gear_local_reports','gear_local_removals','gear_local_moderation_history'])if(has(db,table))db.sqlite.prepare('DELETE FROM '+table+' WHERE listing_id=?').run(id);
 db.sqlite.prepare('DELETE FROM gear_listings WHERE id=?').run(id); // FK cascades: photos, clubs, verification, deletion marker.
 db.sqlite.prepare('UPDATE gear_local_deletion_ledger SET purged_at=? WHERE listing_id=?').run(now,id);
}
export function cleanup(db,{apply=false,now=Date.now()}={}){
 initializeLifecycle(db);
 const ids=db.sqlite.prepare('SELECT listing_id FROM gear_local_deletions WHERE purge_at<=?').all(now);
 if(!apply)return {dueListings:ids.length,applied:false};
 db.sqlite.exec('BEGIN IMMEDIATE');try{
  for(const row of ids)purgeListing(db,row.listing_id,now);
  // Remove private seller/auth rows only when that seller no longer owns any listing.
  const orphan=db.sqlite.prepare('SELECT id FROM gear_sellers WHERE NOT EXISTS(SELECT 1 FROM gear_listings WHERE seller_id=gear_sellers.id)').all();
  for(const {id} of orphan){
   db.sqlite.prepare('DELETE FROM gear_email_changes WHERE seller_id=? OR session_hash IN (SELECT session_hash FROM gear_management_sessions WHERE seller_id=?)').run(id,id);
   db.sqlite.prepare('DELETE FROM gear_management_links WHERE seller_id=?').run(id);
   db.sqlite.prepare('DELETE FROM gear_management_sessions WHERE seller_id=?').run(id);
   db.sqlite.prepare('DELETE FROM gear_sellers WHERE id=?').run(id);
  }
  db.sqlite.exec('COMMIT');return {dueListings:ids.length,applied:true};
 }catch(e){db.sqlite.exec('ROLLBACK');throw e;}
}
