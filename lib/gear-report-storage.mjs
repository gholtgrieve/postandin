import {REPORT_REASONS} from './gear-exchange.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function validateReportSubmission(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||!UUID.test(input.id)||!REPORT_REASONS.includes(input.reason)||typeof input.turnstileToken!=='string')return null;
  return {listingId:input.id,reason:input.reason,turnstileToken:input.turnstileToken};
}

// One INSERT...SELECT keeps the visibility check and report insert atomic.
export async function submitReport(db,{listingId,reason},now=Date.now(),reportId=crypto.randomUUID()){
  const row=await db.prepare(`INSERT INTO gear_reports(id,listing_id,listing_title,reason,created_at)
    SELECT ?,l.id,l.title,?,?
    FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id
    WHERE l.id=? AND l.status IN ('available','pending')
      AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL AND l.expires_at>?
    RETURNING id`).bind(reportId,reason,now,listingId,now).first();
  return Boolean(row);
}
