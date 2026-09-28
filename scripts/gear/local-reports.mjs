// Trusted local sample-data queue only; no moderation or production handler.
import {REPORT_REASONS} from '../../lib/gear-exchange.mjs';
export const REPORT_WINDOW_MS=10*60*1000;
export class ReportError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
export function localReports(db){
 const reports=[];let attempts=[];
 return {
  reports,
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
   reports.push({id:crypto.randomUUID(),listingId:id,listingTitle:listing.title,reason,createdAt:now});
   if(reports.length>20)reports.shift();
   return {ok:true,message:'Report saved to the local review queue. No moderation action was taken.'};
  }
 };
}
