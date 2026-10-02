// Local SQLite moderation only. Authentication is checked again for every action.
import {isDeleted} from './local-lifecycle.mjs';
import {LIMITS} from '../../lib/gear-exchange.mjs';
import {OwnerError} from './owner-auth.mjs';
export function initializeReportQueue(db){db.sqlite.exec(`CREATE TABLE IF NOT EXISTS gear_local_reports (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES gear_listings(id), listing_title TEXT NOT NULL,
 reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolution TEXT NOT NULL DEFAULT 'open');`);}
export function initializeModeration(db){
 initializeReportQueue(db);
 db.sqlite.exec(`CREATE TABLE IF NOT EXISTS gear_local_removals (
 listing_id TEXT PRIMARY KEY REFERENCES gear_listings(id), previous_status TEXT NOT NULL,
 removed_at INTEGER NOT NULL, reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS gear_local_moderation_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
 listing_id TEXT NOT NULL, report_id TEXT, report_reason TEXT, reason TEXT NOT NULL,
 before_status TEXT NOT NULL, after_status TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}
export function localModeration(db,auth){
 initializeModeration(db);
 const conflict=()=>{throw new OwnerError(409,'The listing or report changed, or restoration is not eligible. Refresh and review it.');};
 const listing=id=>db.sqlite.prepare(`SELECT l.id,l.title,l.description,l.category,l.size,l.fit,l.condition,l.city,l.type,l.price_cents AS priceCents,l.trade,l.seller_name AS sellerName,l.status,l.expires_at AS expiresAt,l.verified_at AS verifiedAt,s.verified_at AS sellerVerified,l.seller_id AS sellerId,l.duplicate_key AS duplicateKey
  FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=?`).get(id);
 function publicDetail(row){if(!row)return null;const {sellerId,duplicateKey,...result}=row;return {...result,deleted:isDeleted(db,row.id)};}
 return {
  view(raw){
   auth.session(raw);
   const reports=db.sqlite.prepare('SELECT id,listing_id AS listingId,listing_title AS listingTitle,reason,created_at AS createdAt,resolution FROM gear_local_reports ORDER BY created_at DESC,rowid DESC').all().map(r=>({...r,listing:publicDetail(listing(r.listingId))}));
   const removed=db.sqlite.prepare('SELECT listing_id AS listingId,previous_status AS previousStatus,removed_at AS removedAt,reason FROM gear_local_removals ORDER BY removed_at DESC').all().map(r=>({...r,listing:publicDetail(listing(r.listingId))}));
   const history=db.sqlite.prepare('SELECT id,actor,action,listing_id AS listingId,report_id AS reportId,report_reason AS reportReason,reason,before_status AS beforeStatus,after_status AS afterStatus,created_at AS createdAt FROM gear_local_moderation_history ORDER BY id DESC LIMIT 100').all();
   return {reports,removed,history};
  },
  act(raw,csrf,input,now=Date.now()){
   const actor=auth.authorize(raw,csrf,now);
   if(!input||typeof input!=='object'||Array.isArray(input)||!['dismiss','remove','restore'].includes(input.action)||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>500||/[\x00-\x1f\x7f]/.test(input.reason))throw new OwnerError(400,'Choose an action and provide a reason of 1–500 characters.');
   const {action,id}=input,reason=input.reason.trim();
   db.sqlite.exec('BEGIN IMMEDIATE');
   try{
    const report=action==='restore'?null:db.sqlite.prepare('SELECT * FROM gear_local_reports WHERE id=?').get(id);
    if(action!=='restore'&&(!report||report.resolution!=='open'))conflict();
    const row=listing(action==='restore'?id:report.listing_id);if(!row)conflict();
    const before=row.status;let after=before;
    if(action==='remove'){
     if(!['available','pending'].includes(before)||row.verifiedAt===null||row.sellerVerified===null)conflict();
     db.sqlite.prepare('INSERT INTO gear_local_removals VALUES(?,?,?,?)').run(row.id,before,now,reason);
     db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(row.id);after='removed';
    }
    if(action==='restore'){
     const removal=db.sqlite.prepare('SELECT * FROM gear_local_removals WHERE listing_id=?').get(row.id);
     if(isDeleted(db,row.id)||!removal||before!=='removed'||!['available','pending'].includes(removal.previous_status)||row.verifiedAt===null||row.sellerVerified===null||row.expiresAt<=now)conflict();
     const count=db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE seller_id=? AND status IN ('available','pending') AND expires_at>?").get(row.sellerId,now).n;
     const duplicate=db.sqlite.prepare("SELECT id FROM gear_listings WHERE seller_id=? AND duplicate_key=? AND status IN ('available','pending') AND expires_at>?").get(row.sellerId,row.duplicateKey,now);
     if(count>=LIMITS.activeListings||duplicate)conflict();
     // Same transaction: clean only stale duplicates needed by the existing unique index.
     db.sqlite.prepare("UPDATE gear_listings SET status='expired' WHERE seller_id=? AND duplicate_key=? AND status IN ('available','pending') AND expires_at<=?").run(row.sellerId,row.duplicateKey,now);
     after=removal.previous_status;db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(after,row.id);
     db.sqlite.prepare('DELETE FROM gear_local_removals WHERE listing_id=?').run(row.id);
    }
    if(report)db.sqlite.prepare('UPDATE gear_local_reports SET resolution=? WHERE id=?').run(action==='dismiss'?'dismissed':'removed',id);
    db.sqlite.prepare('INSERT INTO gear_local_moderation_history(actor,action,listing_id,report_id,report_reason,reason,before_status,after_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,action,row.id,report?.id??null,report?.reason??null,reason,before,after,now);
    db.sqlite.exec('COMMIT');return {ok:true};
   }catch(error){db.sqlite.exec('ROLLBACK');throw error;}
  }
 };
}
