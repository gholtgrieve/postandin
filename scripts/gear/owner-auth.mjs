// Local owner scope only. Never accepts a seller session or exposes a login key.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const OWNER_TTL_MS=60*60*1000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const valid=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export class OwnerError extends Error{constructor(status,message){super(message);this.status=status;}}
export function ownerAuth(key){
 if(!valid(key))throw new Error('Invalid local owner key.');
 const keyHash=hash(key);let current=null,attempts=[];
 function session(raw,now=Date.now()){
  if(!valid(raw)||!current||current.hash!==hash(raw)||now<current.createdAt||now>=current.expiresAt)throw new OwnerError(401,'Owner access required.');
  return {csrf:hash('gear-owner-csrf:'+raw),expiresAt:current.expiresAt};
 }
 return {
  session,
  authorize(raw,csrf,now=Date.now()){const access=session(raw,now);if(!valid(csrf)||csrf!==access.csrf)throw new OwnerError(403,'Request not allowed.');return 'local-owner';},
  login(input,now=Date.now()){
   attempts=attempts.filter(t=>t>now-600000);
   if(attempts.length>=10)throw new OwnerError(429,'Too many owner sign-in attempts. Try again later.');
   attempts.push(now);
   if(!valid(input)||!timingSafeEqual(Buffer.from(hash(input),'hex'),Buffer.from(keyHash,'hex')))throw new OwnerError(401,'Owner access required.');
   const raw=token();current={hash:hash(raw),createdAt:now,expiresAt:now+OWNER_TTL_MS};
   return {token:raw,...session(raw,now)};
  },
  logout(raw,csrf,now=Date.now()){this.authorize(raw,csrf,now);current=null;}
 };
}
