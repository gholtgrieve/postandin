import { CATEGORIES, SIZES, CONDITIONS, CLUBS, LISTING_TYPES, LIMITS } from './gear-exchange.mjs';

export class DraftValidationError extends Error {
  constructor(fields) { super('Check the highlighted fields.'); this.fields = fields; }
}
// Shared mailbox normalization for drafts and separately verified transfers.
export function normalizeEmail(value) {
 const email=typeof value==='string'?value.trim().toLowerCase():'';
 const domain=email.split('@')[1]??'';
 if(!email || email.length>LIMITS.email || /[\x00-\x1F\x7F]/.test(email)
  || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)
  || domain.startsWith('.') || domain.endsWith('.') || domain.includes('..') || email.includes('"'))
  throw new DraftValidationError({email:'Enter one valid email address.'});
 return email;
}
// This validates content, not identity. Email ownership is a separate future step.
export function validateDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DraftValidationError({ form: 'Expected a listing object.' });
  }
  const errors = {}, d = {};
  function text(key, limit, required = true, multiline = false) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if ((required && !value) || value.length > limit ||
        (multiline ? /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ : /[\x00-\x1F\x7F]/).test(value)) {
      errors[key] = `Enter ${required ? '1–' : 'up to '}${limit} characters.`;
    }
    d[key] = value;
  }
  for (const key of ['title','description','city','fit']) text(key,LIMITS[key],true,key==='description');
  text('sellerName',LIMITS.name); text('email',LIMITS.email);
  try { d.email=normalizeEmail(d.email); } catch { errors.email='Enter one valid email address.'; }
  for (const [key,values] of Object.entries({category:CATEGORIES,size:SIZES,condition:CONDITIONS,type:LISTING_TYPES})) {
    if (!values.includes(input[key])) errors[key]='Choose a supported option.';
    d[key]=input[key];
  }
  if (input.adult !== true) errors.adult='Confirm that you are 18 or older.';
  if (!Array.isArray(input.clubs) || input.clubs.length>CLUBS.length || input.clubs.some(c=>!CLUBS.includes(c))) errors.clubs='Choose supported clubs.';
  d.clubs=Array.isArray(input.clubs)?[...new Set(input.clubs.filter(c=>CLUBS.includes(c)))]:[];
  if(d.clubs.includes('Other')) text('otherClub',LIMITS.otherClub); else d.otherClub='';
  if(d.type==='trade') text('trade',LIMITS.trade); else d.trade='';
  d.priceCents=d.type==='free'?0:d.type==='trade'?null:input.priceCents;
  if(d.type==='sale' && (!Number.isSafeInteger(d.priceCents)||d.priceCents<LIMITS.minPriceCents||d.priceCents>LIMITS.maxPriceCents)) errors.priceCents='Enter a price from $1 to $5,000 in whole cents.';
  // Unknown fields (including seller ID, status and verification) never survive.
  if(Object.keys(errors).length) throw new DraftValidationError(errors);
  return d;
}
