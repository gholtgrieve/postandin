// LOCAL SAMPLE DATA ONLY. No network delivery, persistence or production mail adapter.
import {createHash} from 'node:crypto';
import {normalizeEmail} from '../../lib/gear-validation.mjs';
export class ContactError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
export const CONTACT_WINDOW_MS=10*60*1000;
export function localContact(db,{sink}={}) {
 const receipts=[];let attempts=[];
 // Synchronous sink contract keeps eligibility checking and acceptance together.
 const deliver=sink===undefined?receipt=>{receipts.push(receipt);if(receipts.length>20)receipts.shift();return true;}:sink;
 return {
  prune(now=Date.now()){for(let i=receipts.length-1;i>=0;i--)if(receipts[i].createdAt<=now-86400000)receipts.splice(i,1);},
  get receipts(){this.prune();return receipts;},
  send(input,now=Date.now()) {
   if(!input||typeof input!=='object'||Array.isArray(input))throw new ContactError(400,'Check your contact details and message.');
   const {id}=input;
   const name=typeof input.name==='string'?input.name.trim():'';
   const message=typeof input.message==='string'?input.message.trim():'';
   let email;try{email=normalizeEmail(input.email);}catch{throw new ContactError(400,'Enter one valid email address.');}
   if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!name||name.length>60||/[\x00-\x1f\x7f]/.test(name)||!message||message.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message))
    throw new ContactError(400,'Check your contact details and message.');
   attempts=attempts.filter(a=>a.at>now-CONTACT_WINDOW_MS);
   const buyer=createHash('sha256').update(email).digest('hex');
   if(attempts.length>=60||attempts.filter(a=>a.buyer===buyer).length>=5||attempts.filter(a=>a.buyer===buyer&&a.id===id).length>=3)
    throw new ContactError(429,'Too many contact attempts. Please try again later.');
   attempts.push({buyer,id,at:now}); // Failures count too; at most 60 entries per server.
   const listing=db.sqlite.prepare(`SELECT l.title,s.email FROM gear_listings l
    JOIN gear_sellers s ON s.id=l.seller_id WHERE l.id=?
    AND l.status IN ('available','pending') AND l.verified_at IS NOT NULL
    AND s.verified_at IS NOT NULL AND l.expires_at>?`).get(id,now);
   if(!listing)throw new ContactError(404,'This listing is no longer available for contact.');
   // Plain text only: user content is never interpolated into HTML or headers.
   const receipt={listingId:id,recipient:listing.email,buyerName:name,buyerEmail:email,message,listingTitle:listing.title,createdAt:now};
   if(typeof deliver!=='function'||deliver(receipt)!==true)throw new Error('Local contact sink did not accept the message.');
   return {ok:true,message:'Saved to the local test inbox. No email was sent.'};
  }
 };
}
