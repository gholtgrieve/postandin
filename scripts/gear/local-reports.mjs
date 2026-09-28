// Trusted local sample-data queue only; no moderation or production handler.
import {initializeReportQueue} from './local-moderation.mjs';
import {REPORT_REASONS} from '../../lib/gear-exchange.mjs';
export const REPORT_WINDOW_MS=10*60*1000;
export class ReportError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
export function localReports(db,{persistent=false}={}){
 if(persistent)initializeReportQueue(db);
 const reports=[];let attempts=[];
 return {
  prune(now=Date.now()){for(let i=reports.length-1;i>=0;i--)if(reports[i].createdAt<=now-30*86400000)reports.splice(i,1);},
  get reports(){this.prune();return persistent?db.sqlite.prepare('SELECT id,listing_id AS listingId,listing_title AS listingTitle,reason,created_at AS createdAt FROM gear_local_reports ORDER BY created_at,rowid').all():reports;},
  submit(input,now=Date.now()){
   if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||!REPORT_REASONS.includes(input.reason))
    throw new ReportError(400,'Choose a supported report reason and listing.');
   const {id,reason}=input;
   attempts=attempts.filter(a=>a.at>now-REPORT_WINDOW_MS);
   if(attempts.length>=20||attempts.filter(a=>a.id===id).length>=3)
    throw new ReportError(429,'Too many report attempts. Please try again later.');
   attempts.push({id,at:now}); // Validated failures count too. At most 20 entries.
   const listing=db.sqlite.prepare(`SELECT l.title FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=?
    AND l.status IN ('available','pending') AND l.verified_at IS NOT NULL
    AND s.verified_at IS NOT NULL AND l.expires_at>?`).get(id,now);
   if(!listing)throw new ReportError(404,'This listing is no longer available to report.');
   if(persistent){
    db.sqlite.exec('BEGIN IMMEDIATE');
    try{
     db.sqlite.prepare('INSERT INTO gear_local_reports(id,listing_id,listing_title,reason,created_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),id,listing.title,reason,now);
     db.sqlite.exec('DELETE FROM gear_local_reports WHERE id NOT IN (SELECT id FROM gear_local_reports ORDER BY created_at DESC,rowid DESC LIMIT 20)');
     db.sqlite.exec('COMMIT');
    }catch(error){db.sqlite.exec('ROLLBACK');throw error;}
   }else{
    reports.push({id:crypto.randomUUID(),listingId:id,listingTitle:listing.title,reason,createdAt:now});
    if(reports.length>20)reports.shift();
   }
   return {ok:true,message:'Report saved to the local review queue. No moderation action was taken.'};
  }
 };
}
